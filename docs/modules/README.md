# CreditCardMaster Modules

![CreditCardMaster feature map](../screenshots/feature-map.svg)

| Module | What it handles |
| --- | --- |
| 💬 [Discord assistant](discord-assistant.md) | Mobile `/offers` queries and Discord bot setup |
| 🔁 [Offer import](offer-refresh.md) | Manual/user-provided offers and local persistence |
| 🧰 [Custom importer template](custom-importer-template.md) | Build your own local offer importer |
| 💳 [Card benefits](card-benefits.md) | Points, cashback, credits, bonus categories, wallet strategy |
| 🔎 [Local RAG retrieval](rag.md) | LangChain + FAISS retrieval for fuzzy merchant, offer, and card context |
| 🐍 [Python runtime](python-runtime.md) | Python CLI implementation that shares the same local data and safety boundary |
| 🛍️ [Shopping portals](shopping-portals.md) | Rakuten portal entry checks |
| 🎯 [Manual offers](manual-offers.md) | Targeted email/app/account-message offers |
| 📰 [Credit card news](doctor-of-credit-monitor.md) | RSS-based daily hot-discussion Discord briefing |

Start here if you want to understand the product surface without reading the source code first.

Run `npm run doctor` after copying `.env.example` to `.env` to check the local setup.
