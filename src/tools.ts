import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// SEC EDGAR API — free, no API key required
// Required: User-Agent header with contact info per SEC guidelines

const USER_AGENT = process.env.SEC_USER_AGENT ?? "MCPServer/1.0 (contact@example.com)";
const EDGAR_API = "https://efts.sec.gov/LATEST";
const EDGAR_DATA = "https://data.sec.gov";

async function edgarFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`SEC EDGAR error ${res.status}: ${await res.text()}`);
  return res.json();
}

function formatLargeNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

// ─── Register all tools ───────────────────────────────────────────────────────

export function registerTools(server: McpServer) {

  // ── Search Companies ────────────────────────────────────────────────────────

  server.tool(
    "search_company",
    "Search SEC EDGAR for a company by name or ticker. Returns CIK number, official name, ticker, exchange, and SIC code.",
    {
      query: z.string().describe("Company name or ticker symbol, e.g. 'Apple' or 'AAPL'"),
    },
    async ({ query }) => {
      const data = await edgarFetch(`${EDGAR_API}/search-index?q=${encodeURIComponent(query)}&dateRange=custom&startdt=2020-01-01&forms=10-K`);

      // Also try the company tickers file for exact ticker match
      let tickerMatch: any = null;
      try {
        const tickers = await edgarFetch(`${EDGAR_DATA}/company_tickers.json`);
        const entries = Object.values(tickers) as any[];
        tickerMatch = entries.find((e: any) =>
          e.ticker?.toUpperCase() === query.toUpperCase() ||
          e.title?.toUpperCase().includes(query.toUpperCase())
        );
      } catch { /* non-critical */ }

      let text = `**SEC EDGAR Search: "${query}"**\n\n`;

      if (tickerMatch) {
        const cik = String(tickerMatch.cik_str).padStart(10, "0");
        text += `**Direct Match:**\n`;
        text += `Company: **${tickerMatch.title}**\n`;
        text += `Ticker: ${tickerMatch.ticker}\n`;
        text += `CIK: ${cik}\n`;
        text += `EDGAR URL: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}\n\n`;
      }

      if (data.hits?.hits?.length) {
        text += `**Recent 10-K Filings:**\n`;
        for (const hit of data.hits.hits.slice(0, 5)) {
          const s = hit._source;
          text += `• ${s.entity_name} — ${s.file_date} (${s.form_type})\n`;
          text += `  CIK: ${s.entity_id} | File: ${s.file_num}\n`;
        }
      }

      if (!tickerMatch && !data.hits?.hits?.length) {
        text += `No results found. Try a different name or ticker symbol.`;
      }

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Get Company Financials ──────────────────────────────────────────────────

  server.tool(
    "get_financials",
    "Get structured financial data from the latest 10-K/10-Q filing. Includes revenue, net income, total assets, EPS, and more from XBRL data.",
    {
      cik: z.string().describe("SEC CIK number (e.g. '0000320193' for Apple). Use search_company to find it."),
    },
    async ({ cik }) => {
      const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
      const data = await edgarFetch(`${EDGAR_DATA}/api/xbrl/companyfacts/CIK${paddedCik}.json`);

      const facts = data.facts;
      const usGaap = facts?.["us-gaap"] ?? {};
      const dei = facts?.dei ?? {};

      const entityName = dei?.EntityCommonStockSharesOutstanding?.units?.shares?.[0]?.entityName
        ?? dei?.EntityPublicFloat?.units?.USD?.[0]?.entityName
        ?? `CIK ${paddedCik}`;

      // Extract key metrics from us-gaap
      function getLatest(concept: string, unit = "USD"): { val: number | null; period: string } {
        const entries = usGaap?.[concept]?.units?.[unit];
        if (!entries?.length) return { val: null, period: "—" };
        // Get latest annual (fy) entry
        const annual = entries.filter((e: any) => e.form === "10-K").sort((a: any, b: any) => b.end.localeCompare(a.end));
        const entry = annual[0] ?? entries[entries.length - 1];
        return { val: entry.val, period: `${entry.fy ?? ""} ${entry.fp ?? ""}`.trim() || entry.end };
      }

      const revenue = getLatest("Revenues") ?? getLatest("RevenueFromContractWithCustomerExcludingAssessedTax");
      const netIncome = getLatest("NetIncomeLoss");
      const totalAssets = getLatest("Assets");
      const totalLiabilities = getLatest("Liabilities");
      const equity = getLatest("StockholdersEquity");
      const cash = getLatest("CashAndCashEquivalentsAtCarryingValue");
      const epsBasic = getLatest("EarningsPerShareBasic", "USD/shares");
      const epsDiluted = getLatest("EarningsPerShareDiluted", "USD/shares");
      const grossProfit = getLatest("GrossProfit");
      const opIncome = getLatest("OperatingIncomeLoss");
      const rd = getLatest("ResearchAndDevelopmentExpense");

      let text = `**Financial Data: ${entityName}**\n`;
      text += `CIK: ${paddedCik}\n\n`;

      text += `### Income Statement\n`;
      text += `| Metric | Value | Period |\n|--------|-------|--------|\n`;
      text += `| Revenue | ${formatLargeNumber(revenue.val)} | ${revenue.period} |\n`;
      text += `| Gross Profit | ${formatLargeNumber(grossProfit.val)} | ${grossProfit.period} |\n`;
      text += `| Operating Income | ${formatLargeNumber(opIncome.val)} | ${opIncome.period} |\n`;
      text += `| Net Income | ${formatLargeNumber(netIncome.val)} | ${netIncome.period} |\n`;
      text += `| R&D Expense | ${formatLargeNumber(rd.val)} | ${rd.period} |\n`;
      text += `| EPS (Basic) | ${epsBasic.val != null ? `$${epsBasic.val.toFixed(2)}` : "—"} | ${epsBasic.period} |\n`;
      text += `| EPS (Diluted) | ${epsDiluted.val != null ? `$${epsDiluted.val.toFixed(2)}` : "—"} | ${epsDiluted.period} |\n`;

      text += `\n### Balance Sheet\n`;
      text += `| Metric | Value | Period |\n|--------|-------|--------|\n`;
      text += `| Total Assets | ${formatLargeNumber(totalAssets.val)} | ${totalAssets.period} |\n`;
      text += `| Total Liabilities | ${formatLargeNumber(totalLiabilities.val)} | ${totalLiabilities.period} |\n`;
      text += `| Stockholders' Equity | ${formatLargeNumber(equity.val)} | ${equity.period} |\n`;
      text += `| Cash & Equivalents | ${formatLargeNumber(cash.val)} | ${cash.period} |\n`;

      if (netIncome.val && revenue.val) {
        const margin = ((netIncome.val / revenue.val) * 100).toFixed(1);
        text += `\n**Net Margin:** ${margin}%\n`;
      }
      if (totalLiabilities.val && equity.val && equity.val !== 0) {
        const debtToEquity = (totalLiabilities.val / equity.val).toFixed(2);
        text += `**Debt-to-Equity:** ${debtToEquity}\n`;
      }

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Get Recent Filings ──────────────────────────────────────────────────────

  server.tool(
    "get_filings",
    "Get recent SEC filings for a company. Includes 10-K, 10-Q, 8-K, and other form types with filing dates and document links.",
    {
      cik: z.string().describe("SEC CIK number"),
      form_type: z.string().optional().describe("Filter by form type: '10-K', '10-Q', '8-K', '4', 'DEF 14A', etc. Empty for all types."),
      limit: z.number().min(1).max(40).default(10).describe("Number of filings to return (default: 10, max: 40)"),
    },
    async ({ cik, form_type, limit }) => {
      const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
      const data = await edgarFetch(`${EDGAR_DATA}/submissions/CIK${paddedCik}.json`);

      const recent = data.filings?.recent;
      if (!recent?.form?.length) {
        return { content: [{ type: "text", text: `No filings found for CIK ${paddedCik}.` }] };
      }

      let text = `**Recent Filings: ${data.name}** (${data.tickers?.join(", ") ?? "no ticker"})\n`;
      text += `CIK: ${paddedCik} | SIC: ${data.sic ?? "—"} (${data.sicDescription ?? "—"})\n`;
      text += `State: ${data.stateOfIncorporation ?? "—"} | Exchange: ${data.exchanges?.join(", ") ?? "—"}\n\n`;

      text += `| Date | Form | Description | Accession |\n`;
      text += `|------|------|-------------|----------|\n`;

      let count = 0;
      for (let i = 0; i < recent.form.length && count < limit; i++) {
        if (form_type && recent.form[i] !== form_type) continue;
        const accession = recent.accessionNumber[i]?.replace(/-/g, "");
        text += `| ${recent.filingDate[i]} | ${recent.form[i]} | ${(recent.primaryDocDescription[i] ?? "—").slice(0, 50)} | [Link](https://www.sec.gov/Archives/edgar/data/${paddedCik.replace(/^0+/, "")}/${accession}/${recent.primaryDocument[i]}) |\n`;
        count++;
      }

      if (count === 0) {
        text += `| — | No ${form_type ?? ""} filings found | — | — |\n`;
      }

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Insider Trades ──────────────────────────────────────────────────────────

  server.tool(
    "get_insider_trades",
    "Get insider trading activity (Form 4 filings) for a company. Shows who bought/sold, dates, amounts, and prices.",
    {
      cik: z.string().describe("SEC CIK number of the company"),
      limit: z.number().min(1).max(40).default(10).describe("Number of Form 4 filings (default: 10)"),
    },
    async ({ cik, limit }) => {
      const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
      const data = await edgarFetch(`${EDGAR_DATA}/submissions/CIK${paddedCik}.json`);

      const recent = data.filings?.recent;
      if (!recent?.form?.length) {
        return { content: [{ type: "text", text: `No filings found for CIK ${paddedCik}.` }] };
      }

      let text = `**Insider Trading Activity: ${data.name}**\n\n`;
      text += `| Date | Form | Filer | Document |\n`;
      text += `|------|------|-------|----------|\n`;

      let count = 0;
      for (let i = 0; i < recent.form.length && count < limit; i++) {
        const form = recent.form[i];
        if (form !== "4" && form !== "3" && form !== "5") continue;
        const accession = recent.accessionNumber[i]?.replace(/-/g, "");
        const filer = recent.primaryDocDescription[i] ?? "—";
        text += `| ${recent.filingDate[i]} | ${form} | ${filer.slice(0, 60)} | [View](https://www.sec.gov/Archives/edgar/data/${paddedCik.replace(/^0+/, "")}/${accession}/${recent.primaryDocument[i]}) |\n`;
        count++;
      }

      if (count === 0) {
        text += `| — | No insider filings found | — | — |\n`;
      }

      text += `\n*Form 3: Initial ownership | Form 4: Changes in ownership | Form 5: Annual changes*`;

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Full-Text Filing Search ─────────────────────────────────────────────────

  server.tool(
    "search_filings",
    "Full-text search across all SEC EDGAR filings. Search for specific terms, risk factors, revenue mentions, etc.",
    {
      query: z.string().describe("Search query, e.g. 'artificial intelligence revenue growth'"),
      form_type: z.string().optional().describe("Filter by form type: '10-K', '10-Q', '8-K', etc."),
      date_from: z.string().optional().describe("Start date YYYY-MM-DD"),
      date_to: z.string().optional().describe("End date YYYY-MM-DD"),
      limit: z.number().min(1).max(50).default(10).describe("Number of results (default: 10)"),
    },
    async ({ query, form_type, date_from, date_to, limit }) => {
      let url = `${EDGAR_API}/search-index?q=${encodeURIComponent(query)}`;
      if (form_type) url += `&forms=${form_type}`;
      if (date_from || date_to) {
        url += `&dateRange=custom`;
        if (date_from) url += `&startdt=${date_from}`;
        if (date_to) url += `&enddt=${date_to}`;
      }

      const data = await edgarFetch(url);
      const hits = data.hits?.hits ?? [];

      if (!hits.length) {
        return { content: [{ type: "text", text: `No filings found matching "${query}".` }] };
      }

      let text = `**EDGAR Full-Text Search: "${query}"**\n`;
      text += `Total results: ${data.hits.total.value}\n\n`;

      for (const hit of hits.slice(0, limit)) {
        const s = hit._source;
        text += `---\n`;
        text += `**${s.entity_name}** (${s.ticker ?? "—"})\n`;
        text += `Form: ${s.form_type} | Filed: ${s.file_date}\n`;
        text += `CIK: ${s.entity_id}\n`;
        if (hit.highlight?.["_source.file_description"]?.length) {
          text += `Match: ...${hit.highlight["_source.file_description"][0]}...\n`;
        }
        text += `\n`;
      }

      return { content: [{ type: "text", text }] };
    }
  );

  // ── Company Facts Concept ───────────────────────────────────────────────────

  server.tool(
    "get_financial_history",
    "Get the historical time series for a specific financial concept (e.g., Revenue, NetIncomeLoss) for a company. Shows all reported values across all filings.",
    {
      cik: z.string().describe("SEC CIK number"),
      concept: z.string().describe("US-GAAP concept name: 'Revenues', 'NetIncomeLoss', 'Assets', 'EarningsPerShareBasic', 'OperatingIncomeLoss', 'ResearchAndDevelopmentExpense', etc."),
      unit: z.string().default("USD").describe("Unit: 'USD', 'USD/shares', 'shares', 'pure'"),
    },
    async ({ cik, concept, unit }) => {
      const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
      const data = await edgarFetch(`${EDGAR_DATA}/api/xbrl/companyconcept/CIK${paddedCik}/us-gaap/${concept}.json`);

      const entries = data.units?.[unit];
      if (!entries?.length) {
        return { content: [{ type: "text", text: `No data found for ${concept} (${unit}) for CIK ${paddedCik}. Try a different concept name or unit.` }] };
      }

      // Filter to annual (10-K) only and deduplicate by fiscal year
      const annual = entries
        .filter((e: any) => e.form === "10-K")
        .sort((a: any, b: any) => a.end.localeCompare(b.end));

      const seen = new Set<string>();
      const unique = annual.filter((e: any) => {
        const key = `${e.fy}-${e.fp}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let text = `**${concept} History: ${data.entityName}**\n`;
      text += `CIK: ${paddedCik} | Unit: ${unit}\n\n`;
      text += `| Period | End Date | Value | Form |\n`;
      text += `|--------|----------|-------|------|\n`;

      for (const e of unique.slice(-15)) {
        const formattedVal = unit === "USD" ? formatLargeNumber(e.val) : e.val?.toLocaleString() ?? "—";
        text += `| FY${e.fy ?? "?"} ${e.fp ?? ""} | ${e.end} | ${formattedVal} | ${e.form} |\n`;
      }

      if (unique.length >= 2) {
        const first = unique[unique.length - 2].val;
        const last = unique[unique.length - 1].val;
        if (first && last && first !== 0) {
          const yoyChange = (((last - first) / Math.abs(first)) * 100).toFixed(1);
          text += `\n**YoY Change (latest):** ${Number(yoyChange) > 0 ? "+" : ""}${yoyChange}%\n`;
        }
      }

      return { content: [{ type: "text", text }] };
    }
  );
}
