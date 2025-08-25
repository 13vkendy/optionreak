// index.js
require("dotenv").config();
const express = require("express");
const { Telegraf, Markup, session } = require("telegraf");

const tokens = process.env.BOT_TOKENS.split(",");
const CHANNEL_ID = process.env.CHANNEL_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!tokens || tokens.length === 0) {
  console.error("❌ Error: BOT_TOKENS .env da yo‘q!");
  process.exit(1);
}

// --- In-memory store ---
const monitors = new Map();
const EMOJIS = ["👍", "❤️", "🔥", "😂", "😮", "🎉", "👏", "😢"];

function mkKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}
function prettyList(arr) {
  return arr && arr.length ? arr.join(" ") : "(hech narsa)";
}

function buildEmojiKeyboard(selected = []) {
  const rows = [];
  for (let i = 0; i < EMOJIS.length; i += 4) {
    const row = EMOJIS.slice(i, i + 4).map((e) => {
      const picked = selected.includes(e) ? `✅ ${e}` : e;
      return Markup.button.callback(picked, `emoji_toggle:${e}`);
    });
    rows.push(row);
  }
  rows.push([Markup.button.callback("✅ Tayyor", "emoji_done")]);
  rows.push([Markup.button.callback("❌ Bekor qilish", "emoji_cancel")]);
  return Markup.inlineKeyboard(rows);
}

function buildThresholdKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("1", "thr:1"),
      Markup.button.callback("3", "thr:3"),
      Markup.button.callback("5", "thr:5"),
    ],
    [
      Markup.button.callback("10", "thr:10"),
      Markup.button.callback("Custom...", "thr:custom"),
    ],
    [Markup.button.callback("❌ Bekor", "thr:cancel")],
  ]);
}

// --- Handlers ---
function setupHandlers(bot) {
  bot.use(session());

  bot.start(async (ctx) => {
    await ctx.reply(
      "👋 Salom!\nKanal postini forward qiling ➜ emoji tanlang ➜ threshold qo‘ying ➜ men monitoring qilaman."
    );
  });

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    const fwdChat = msg.forward_from_chat;
    const fwdMsgId = msg.forward_from_message_id;
    if (!fwdChat || !fwdMsgId) return;

    if (String(fwdChat.id) !== String(CHANNEL_ID)) {
      return ctx.reply("❌ Bu kanal emas. Faqat sozlangan kanal postini yuboring.");
    }

    ctx.session.monitor = {
      ownerId: ctx.from.id,
      chatId: fwdChat.id,
      messageId: fwdMsgId,
      reactions: [],
      threshold: null,
    };

    await ctx.reply(
      `🟢 Post qabul qilindi.\nID: ${fwdChat.id}:${fwdMsgId}\nEndi qaysi reaksiyalarni kuzatmoqchisiz?`,
      buildEmojiKeyboard([])
    );
  });

  bot.action(/^emoji_toggle:(.+)$/, async (ctx) => {
    const emoji = ctx.match[1];
    if (!ctx.session?.monitor) return ctx.answerCbQuery("Avval postni forward qiling!");
    const arr = ctx.session.monitor.reactions || [];
    ctx.session.monitor.reactions = arr.includes(emoji)
      ? arr.filter((e) => e !== emoji)
      : [...arr, emoji];
    await ctx.editMessageText(
      `🟢 Tanlangan reaksiyalar: ${prettyList(ctx.session.monitor.reactions)}`,
      buildEmojiKeyboard(ctx.session.monitor.reactions)
    );
    await ctx.answerCbQuery();
  });

  bot.action("emoji_done", async (ctx) => {
    if (!ctx.session?.monitor) return ctx.answerCbQuery("Avval postni forward qiling!");
    if (!ctx.session.monitor.reactions.length)
      return ctx.answerCbQuery("Hech narsa tanlanmadi!");
    await ctx.editMessageText(
      `✅ Tanlangan: ${prettyList(ctx.session.monitor.reactions)}\nEndi threshold tanlang:`,
      buildThresholdKeyboard()
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^thr:(.+)$/, async (ctx) => {
    const v = ctx.match[1];
    if (!ctx.session?.monitor) return;
    if (v === "cancel") {
      ctx.session.monitor = null;
      return ctx.editMessageText("❌ Jarayon bekor qilindi.");
    }
    if (v === "custom") {
      ctx.session.awaitingCustomThreshold = true;
      return ctx.editMessageText("Kerakli sonni yozing (masalan: 10).");
    }
    ctx.session.monitor.threshold = parseInt(v, 10) || 1;
    await ctx.editMessageText(
      `👀 Monitoring sozlandi.\nReaksiyalar: ${prettyList(ctx.session.monitor.reactions)}\nTrigger: ${ctx.session.monitor.threshold}\n\nTasdiqlaysizmi?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📌 Tasdiqlash", "confirm_monitor")],
        [Markup.button.callback("❌ Bekor qilish", "cancel_monitor")],
      ])
    );
    await ctx.answerCbQuery();
  });

  bot.action("confirm_monitor", async (ctx) => {
    const m = ctx.session.monitor;
    if (!m) return;
    monitors.set(mkKey(m.chatId, m.messageId), m);
    try {
      if (m.reactions[0]) {
        await bot.telegram.setMessageReaction(m.chatId, m.messageId, m.reactions[0], true);
      }
    } catch (err) {
      console.error("setMessageReaction error", err);
    }
    await ctx.editMessageText(
      `✅ Monitoring boshlandi!\nPost: ${m.chatId}:${m.messageId}\nReaksiyalar: ${prettyList(m.reactions)}\nTrigger: ${m.threshold}`
    );
    ctx.session.monitor = null;
  });

  bot.command("monitors", async (ctx) => {
    const userId = ctx.from.id;
    const list = [];
    for (const [k, m] of monitors.entries()) {
      if (m.ownerId === userId) {
        list.push(`${k} — ${prettyList(m.reactions)} — thr: ${m.threshold}`);
      }
    }
    if (!list.length) return ctx.reply("Sizda monitorlar yo‘q.");
    await ctx.reply("Sizning monitorlaringiz:\n" + list.join("\n\n"));
  });
}

// --- Multi-bot yaratish ---
const bots = tokens.map((t) => {
  const bot = new Telegraf(t.trim(), { handlerTimeout: 10000 });
  setupHandlers(bot);
  return bot;
});

// --- Launch ---
(async () => {
  if (WEBHOOK_URL) {
    const app = express();
    bots.forEach((bot) => {
      const path = `/tg/${bot.secretPathComponent()}`;
      app.use(bot.webhookCallback(path));
      bot.telegram.setWebhook(`${WEBHOOK_URL}${path}`, {
        allowed_updates: ["message", "callback_query", "message_reaction", "message_reaction_count"],
      });
    });
    app.get("/", (req, res) => res.send("ok"));
    app.listen(PORT, () => console.log("🌐 Webhook server on", PORT));
  } else {
    for (const bot of bots) {
      await bot.launch({
        allowedUpdates: ["message", "callback_query", "message_reaction", "message_reaction_count"],
      });
      console.log("🤖 Bot started:", (await bot.telegram.getMe()).username);
    }
  }
})();

process.once("SIGINT", () => bots.forEach((b) => b.stop("SIGINT")));
process.once("SIGTERM", () => bots.forEach((b) => b.stop("SIGTERM")));
