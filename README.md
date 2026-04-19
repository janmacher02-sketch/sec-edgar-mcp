# SEC EDGAR Financial Data MCP Server

MCP server for SEC EDGAR financial data. Works with Claude Desktop, Cursor, and any MCP-compatible AI assistant.

## Tools

| Tool | Description |
|------|-------------|
| `search_company` | Search companies by name or ticker, get CIK number |
| `get_financials` | Structured financial data from latest 10-K — revenue, net income, EPS, assets, liabilities |
| `get_filings` | List recent filings (10-K, 10-Q, 8-K, etc.) with direct document links |
| `get_insider_trades` | Insider trading activity (Form 3, 4, 5) — who bought/sold and when |
| `search_filings` | Full-text search across all SEC filings for any term |
| `get_financial_history` | Historical time series for any financial concept (revenue, income, etc.) |

## Installation

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sec-edgar": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/sec-edgar-mcp/src/index.ts"],
      "env": {
        "SEC_USER_AGENT": "MyApp/1.0 contact@example.com"
      }
    }
  }
}
```

## Setup

**No API key required!** SEC EDGAR is a free public API.

The SEC requires a User-Agent header with your contact info. Set `SEC_USER_AGENT` to something like `"MyApp/1.0 your@email.com"`.

## Example Prompts

```
Look up Apple on SEC EDGAR
Get financials for Apple (CIK 0000320193)
Show me Tesla's recent 10-K filings
Any insider trades at NVIDIA recently?
Search filings mentioning "artificial intelligence revenue"
Show Apple's revenue history over the last 10 years
Compare net income trends for AAPL, MSFT, and GOOGL
```

## Data Sources

- **SEC EDGAR XBRL API** — Structured financial data from company filings
- **SEC EDGAR Full-Text Search** — Search across all SEC filings
- **SEC EDGAR Submissions** — Filing history, insider trades, company metadata

All data is sourced directly from the U.S. Securities and Exchange Commission — the official source of truth for public company financials.

## Requirements

- Node.js 18+
- No API keys needed — SEC EDGAR is free and public

## Pricing

| Tier | Limit | Price |
|------|-------|-------|
| Free | 10 calls/day | $0 |
| Pro | Unlimited | $99/month |

## License

MIT
