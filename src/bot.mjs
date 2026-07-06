import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, getAllowedUserIds } from "./config.mjs";
import { getStatus, migrate, openDb } from "./db.mjs";
import { askWithRecommendations, formatSearchWithRecommendations } from "./benefits.mjs";
import { askCCM } from "./ask-ccm.mjs";
import { expiringOffers, formatOffers, searchOffers } from "./search.mjs";
import { sendWebhook } from "./notify.mjs";
import { addManualOffer, addManualOfferFromText, formatManualOfferResult } from "./manual-offers.mjs";
import { listCanonicalCategoryIds } from "./canonical.mjs";
import {
  addWatch,
  formatRemoveWatchResult,
  formatWatchResult,
  formatWatchlist,
  listWatchlist,
  removeWatch,
} from "./watchlist.mjs";
import { formatWalletStrategy, loadWalletStrategy } from "./wallet-strategy.mjs";
import { issuerChoices } from "./distribution.mjs";
import { buildPortalChecks, formatPortalCheck } from "./portals.mjs";

loadEnv();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const allowedUserIds = getAllowedUserIds();

if (!token || !clientId || !guildId) {
  console.error("Missing DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID.");
  process.exit(1);
}

if (allowedUserIds.size === 0) {
  console.error("DISCORD_ALLOWED_USER_IDS must contain at least one authorized Discord user ID.");
  process.exit(1);
}

const db = openDb();
migrate(db);
const interactionLogPath = join(process.cwd(), "state", "ccm-interactions.log");

const categoryChoices = listCanonicalCategoryIds().map((category) => ({
  name: category.replaceAll("_", " "),
  value: category,
}));
const manualOfferIssuerChoices = issuerChoices(process.env);

const commands = [
  new SlashCommandBuilder()
    .setName("offers")
    .setDescription("Search local credit card offers")
    .addStringOption((option) =>
      option.setName("query").setDescription("Merchant or category").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("bestcard")
    .setDescription("Recommend which card to use, even when no offer matches")
    .addStringOption((option) =>
      option.setName("query").setDescription("Merchant or category").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("askccm")
    .setDescription("Ask CreditCardMaster a general checkout, offer, wallet, or portal question")
    .addStringOption((option) =>
      option.setName("query").setDescription("Natural-language question").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("rakuten")
    .setDescription("Open a Rakuten search entry for a merchant")
    .addStringOption((option) =>
      option.setName("query").setDescription("Merchant, e.g. Macy's or Nike").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("expiring")
    .setDescription("Show offers expiring soon")
    .addIntegerOption((option) =>
      option.setName("days").setDescription("Days ahead").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("addoffer")
    .setDescription("Add a manual temporary or targeted offer")
    .addStringOption((option) =>
      option
        .setName("issuer")
        .setDescription("Issuer")
        .setRequired(true)
        .addChoices(...manualOfferIssuerChoices),
    )
    .addStringOption((option) =>
      option.setName("merchant").setDescription("Merchant or offer label").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reward").setDescription("Reward text, e.g. 5X gas for 3 months").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("category")
        .setDescription("Offer category")
        .setRequired(true)
        .addChoices(...categoryChoices),
    )
    .addStringOption((option) =>
      option.setName("expires").setDescription("YYYY-MM-DD, optional").setRequired(false),
    )
    .addStringOption((option) =>
      option.setName("card_last4").setDescription("Card last 4/5 digits, optional").setRequired(false),
    )
    .addStringOption((option) =>
      option.setName("card_name").setDescription("Card name, optional").setRequired(false),
    )
    .addBooleanOption((option) =>
      option.setName("activated").setDescription("Already activated/enrolled?").setRequired(false),
    )
    .addBooleanOption((option) =>
      option.setName("activation_required").setDescription("Needs activation? Default true").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("pasteoffer")
    .setDescription("Paste offer text and let CreditCardMaster parse it")
    .addStringOption((option) =>
      option
        .setName("issuer")
        .setDescription("Issuer")
        .setRequired(true)
        .addChoices(...manualOfferIssuerChoices),
    )
    .addStringOption((option) =>
      option.setName("text").setDescription("Full copied offer text").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("card_last4").setDescription("Card last 4/5 digits, optional").setRequired(false),
    )
    .addStringOption((option) =>
      option.setName("card_name").setDescription("Card name, optional").setRequired(false),
    )
    .addBooleanOption((option) =>
      option.setName("activated").setDescription("Already activated/enrolled?").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Watch a merchant or category for useful offers")
    .addStringOption((option) =>
      option.setName("query").setDescription("Merchant/category, e.g. Macy's, gas, Hyatt").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("unwatch")
    .setDescription("Remove a watched merchant or category")
    .addStringOption((option) =>
      option.setName("query").setDescription("Watched merchant/category").setRequired(true),
    ),
  new SlashCommandBuilder().setName("watchlist").setDescription("Show watched merchants and categories"),
  new SlashCommandBuilder().setName("walletstrategy").setDescription("Show current wallet strategy"),
  new SlashCommandBuilder().setName("offerstatus").setDescription("Show local offer DB status"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);
try {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
} catch (error) {
  console.warn(`Discord command registration failed; continuing with existing commands: ${error.message}`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error(`Interaction failed: ${error.stack || error.message}`);
    await replyWithError(interaction, error);
  }
});

client.on("error", (error) => {
  console.error(`Discord client error: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (error) => {
  console.error(`Unhandled rejection: ${error?.stack || error}`);
});

process.on("uncaughtException", (error) => {
  console.error(`Uncaught exception: ${error.stack || error.message}`);
});

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (allowedUserIds.size > 0 && !allowedUserIds.has(interaction.user.id)) {
    await interaction.reply({ content: "Not authorized.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "offers") {
    const query = interaction.options.getString("query", true);
    await interaction.deferReply({ ephemeral: true });
    const result = await askWithRecommendations(db, query);
    const output = formatSearchWithRecommendations(result);
    logInteraction({ interaction, query, route: "offers", output });
    await interaction.editReply(codeBlock(output));
    return;
  }

  if (interaction.commandName === "bestcard") {
    const query = interaction.options.getString("query", true);
    await interaction.deferReply({ ephemeral: true });
    const result = await askWithRecommendations(db, query);
    const output = formatSearchWithRecommendations(result, { showOffers: false });
    logInteraction({ interaction, query, route: "bestcard", output });
    await interaction.editReply(codeBlock(output));
    return;
  }

  if (interaction.commandName === "askccm") {
    const query = interaction.options.getString("query", true);
    await interaction.deferReply({ ephemeral: true });
    const answer = await askCCM(db, query);
    logInteraction({ interaction, query, route: answer.route?.type || "askccm", output: answer.output });
    await interaction.editReply(codeBlock(answer.output));
    return;
  }

  if (interaction.commandName === "rakuten") {
    const query = interaction.options.getString("query", true);
    const checks = buildPortalChecks({ merchant: query, rawQuery: query });
    const output = checks.length ? checks.map((check) => formatPortalCheck(check)).join("\n") : "No Rakuten check for this query.";
    logInteraction({ interaction, query, route: "rakuten", output });
    await interaction.reply({ content: codeBlock(output), ephemeral: true });
    return;
  }

  if (interaction.commandName === "expiring") {
    const days = interaction.options.getInteger("days") || 14;
    await interaction.reply({ content: codeBlock(formatOffers(expiringOffers(db, days))), ephemeral: true });
    return;
  }

  if (interaction.commandName === "addoffer") {
    try {
      const offer = addManualOffer(db, {
        issuer: interaction.options.getString("issuer", true),
        merchant: interaction.options.getString("merchant", true),
        rewardText: interaction.options.getString("reward", true),
        category: interaction.options.getString("category", true),
        expiresOn: interaction.options.getString("expires", false),
        cardLast4: interaction.options.getString("card_last4", false),
        cardName: interaction.options.getString("card_name", false),
        activated: interaction.options.getBoolean("activated", false) ?? false,
        activationRequired: interaction.options.getBoolean("activation_required", false) ?? true,
      });
      await interaction.reply({ content: codeBlock(formatManualOfferResult(offer)), ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Could not add offer: ${error.message}`, ephemeral: true });
    }
    return;
  }

  if (interaction.commandName === "pasteoffer") {
    try {
      const offer = addManualOfferFromText(db, {
        issuer: interaction.options.getString("issuer", true),
        text: interaction.options.getString("text", true),
        cardLast4: interaction.options.getString("card_last4", false),
        cardName: interaction.options.getString("card_name", false),
        activated: interaction.options.getBoolean("activated", false) ?? undefined,
      });
      await interaction.reply({ content: codeBlock(formatManualOfferResult(offer)), ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Could not parse offer: ${error.message}`, ephemeral: true });
    }
    return;
  }

  if (interaction.commandName === "watch") {
    try {
      const item = addWatch(db, interaction.options.getString("query", true));
      await interaction.reply({ content: codeBlock(formatWatchResult(item)), ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Could not add watch: ${error.message}`, ephemeral: true });
    }
    return;
  }

  if (interaction.commandName === "unwatch") {
    const result = removeWatch(db, interaction.options.getString("query", true));
    await interaction.reply({ content: codeBlock(formatRemoveWatchResult(result)), ephemeral: true });
    return;
  }

  if (interaction.commandName === "watchlist") {
    await interaction.reply({ content: codeBlock(formatWatchlist(listWatchlist(db))), ephemeral: true });
    return;
  }

  if (interaction.commandName === "walletstrategy") {
    await interaction.reply({ content: codeBlock(formatWalletStrategy(loadWalletStrategy())), ephemeral: true });
    return;
  }

  if (interaction.commandName === "offerstatus") {
    await interaction.reply({ content: codeBlock(JSON.stringify(getStatus(db), null, 2)), ephemeral: true });
  }
}

client.once("clientReady", async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  try {
    await sendWebhook("CreditCardMaster bot is running.");
  } catch (error) {
    console.warn(`Discord webhook startup notice failed: ${error.message}`);
  }
});

await client.login(token);

function codeBlock(text) {
  const safe = String(text).slice(0, 1800).replaceAll("```", "`\u200b``");
  return `\`\`\`\n${safe}\n\`\`\``;
}

function logInteraction({ interaction, query, route, output }) {
  try {
    mkdirSync(join(process.cwd(), "state"), { recursive: true });
    appendFileSync(interactionLogPath, `${JSON.stringify({
      at: new Date().toISOString(),
      command: interaction.commandName,
      route,
      query,
      output: String(output || "").slice(0, 2500),
    })}\n`);
  } catch (error) {
    console.warn(`Could not write interaction log: ${error.message}`);
  }
}

async function replyWithError(interaction, error) {
  logInteraction({
    interaction,
    query: interaction?.options?.getString?.("query", false) || "",
    route: "error",
    output: error.message,
  });
  if (!interaction?.isRepliable?.()) return;
  const content = codeBlock(`CreditCardMaster error: ${error.message}`);
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (replyError) {
    console.error(`Could not send error reply: ${replyError.stack || replyError.message}`);
  }
}
