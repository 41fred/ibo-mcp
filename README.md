# IBO Studio MCP Server

Commission cinematic campaign films and image sets from [IBO](https://ibouniverse.com), an AI-native film studio, directly from your AI assistant.

## Connect

No API key. Point any MCP client at the remote server:

```
https://ibouniverse.com/mcp
```

- **Claude**: Settings → Connectors → add the URL. Claude Code: `claude mcp add --transport http ibo https://ibouniverse.com/mcp`
- **ChatGPT**: developer mode → add connector
- **Cursor / Windsurf / other MCP clients**: add as a remote (Streamable HTTP) server

## Tools

| Tool | What it does |
|---|---|
| `list_offers` | Packages, prices, 50% deposits, deliverables, refund/fit policy |
| `create_checkout` | Creates a Stripe Checkout for the deposit; your user approves payment |
| `get_order` | Verifies payment server-side after checkout |
| `create_upload_url` | Presigned upload for brand assets (paid orders) |
| `submit_brief` | Files the creative brief against the paid order |

## Payment safety

- Prices are fixed server-side; agents cannot alter them.
- Agents never see card data. Payment happens only on Stripe's hosted checkout, approved by the human customer.
- Payment status is only established by server-side verification, never from URL parameters.

## Plain HTTP alternative

Everything is also available as documented JSON endpoints: [llms.txt](https://ibouniverse.com/llms.txt) and an [OpenAPI 3.1 spec](https://ibouniverse.com/openapi.json) (GPT Actions compatible).

## About

IBO creates cinematic campaign films and images for brands, from concept and storyboard through AI production, editing, sound, and delivery. Human-directed, AI-produced. [ibouniverse.com](https://ibouniverse.com)
