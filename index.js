// multi_reaction_bot.js
require("dotenv").config();
const express = require("express");
const { Telegraf, Markup, session } = require("telegraf");

// 🔑 Bir nechta tokenlarni o‘qish
const TOKENS = process.env.BOT_TOKENS.split(",");
const CHANNEL_ID = process.env.CHANNEL_ID; // -100...
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!TOKENS || TOKENS.length === 0) {
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

// --- Keyboard builders ---
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

// --- Setup handlerlar ---
function setupHandlers(bot) {
  bot.use(session());

  bot.start(async (ctx) => {
    await ctx.reply(
      "Salom! Kanal postini forward qiling ➜ emoji tanlang ➜ threshold qo‘ying ➜ tasdiqlang ➜ men monitoring qilaman."
    );
  });

  // 🔑 Forward handler (ikkala eski va yangi struktura uchun)
// 🔑 Forward handler (eski va yangi strukturaga mos)
bot.on("message", async (ctx) => {
  try {
    const msg = ctx.message;
    let fwdChat = null;
    let fwdMsgId = null;

    // Eski forward format
    if (msg.forward_from_chat && msg.forward_from_message_id) {
      fwdChat = msg.forward_from_chat;
      fwdMsgId = msg.forward_from_message_id;
    }

    // Yangi forward format (forward_origin)
    if (msg.forward_origin?.chat && msg.forward_origin?.message_id) {
      fwdChat = msg.forward_origin.chat;
      fwdMsgId = msg.forward_origin.message_id;
    }

    if (!fwdChat || !fwdMsgId) {
      return ctx.reply("❌ Bu forward emas. Kanal postini forward qiling.");
    }

    // Kanalni tekshirish
    if (String(fwdChat.id) !== String(CHANNEL_ID)) {
      return ctx.reply("❌ Bu sozlangan kanal emas.");
    }

    ctx.session.monitor = {
      ownerId: ctx.from.id,
      chatId: fwdChat.id,
      messageId: fwdMsgId,
      reactions: [],
      threshold: null,
    };

    await ctx.reply(
      `🟢 Post qabul qilindi.\nID: ${fwdChat.id}:${fwdMsgId}\nEndi reaksiyalarni tanlang:`,
      buildEmojiKeyboard([])
    );
  } catch (err) {
    console.error("❌ Forward handler error:", err);
  }
});


  // Emoji toggle
  bot.action(/^emoji_toggle:(.+)$/, async (ctx) => {
    const emoji = ctx.match[1];
    if (!ctx.session?.monitor) return ctx.answerCbQuery("Avval postni forward qiling!");
    const arr = ctx.session.monitor.reactions || [];
    if (arr.includes(emoji)) {
      ctx.session.monitor.reactions = arr.filter((e) => e !== emoji);
    } else {
      ctx.session.monitor.reactions = [...arr, emoji];
    }
    await ctx.editMessageText(
      `🟢 Tanlangan: ${prettyList(ctx.session.monitor.reactions)}`,
      buildEmojiKeyboard(ctx.session.monitor.reactions)
    );
    await ctx.answerCbQuery();
  });

  // Done
  bot.action("emoji_done", async (ctx) => {
    if (!ctx.session?.monitor?.reactions.length)
      return ctx.answerCbQuery("Hech narsa tanlanmadi!");
    await ctx.editMessageText(
      `✅ Tanlangan: ${prettyList(
        ctx.session.monitor.reactions
      )}\nEndi threshold tanlang:`,
      buildThresholdKeyboard()
    );
    await ctx.answerCbQuery();
  });

  // Threshold
  bot.action(/^thr:(.+)$/, async (ctx) => {
    const v = ctx.match[1];
    if (!ctx.session?.monitor) return;
    if (v === "cancel") {
      ctx.session.monitor = null;
      return ctx.editMessageText("❌ Bekor qilindi.");
    }
    if (v === "custom") {
      ctx.session.awaitingCustomThreshold = true;
      return ctx.editMessageText("Kerakli sonni yozing (masalan: 10).");
    }
    ctx.session.monitor.threshold = parseInt(v, 10) || 1;
    await ctx.editMessageText(
      `👀 Monitoring sozlandi.\nReaksiyalar: ${prettyList(
        ctx.session.monitor.reactions
      )}\nTrigger: ${ctx.session.monitor.threshold}\n\nTasdiqlaysizmi?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📌 Tasdiqlash", "confirm_monitor")],
        [Markup.button.callback("❌ Bekor qilish", "cancel_monitor")],
      ])
    );
    await ctx.answerCbQuery();
  });

  // Confirm monitor
  bot.action("confirm_monitor", async (ctx) => {
    const m = ctx.session.monitor;
    if (!m) return;
    monitors.set(mkKey(m.chatId, m.messageId), m);
    try {
      if (m.reactions[0]) {
        await bot.telegram.setMessageReaction(
          m.chatId,
          m.messageId,
          [{ type: "emoji", emoji: m.reactions[0] }],
          true
        );
      }
    } catch (err) {
      console.error("setMessageReaction error", err);
    }
    await ctx.editMessageText(
      `✅ Monitoring boshlandi!\nPost: ${m.chatId}:${m.messageId}\nReaksiyalar: ${prettyList(
        m.reactions
      )}\nTrigger: ${m.threshold}`
    );
    ctx.session.monitor = null;
  });

  // /monitors
  bot.command("monitors", async (ctx) => {
    const userId = ctx.from.id;
    const list = [];
    for (const [k, m] of monitors.entries()) {
      if (m.ownerId === userId) {
        list.push(`${k} — ${prettyList(m.reactions)} — thr: ${m.threshold}`);
      }
    }
    if (!list.length) return ctx.reply("Monitorlar yo‘q.");
    await ctx.reply("Sizning monitorlaringiz:\n" + list.join("\n\n"));
  });
}

// --- Har bir token uchun bot yaratish ---
const bots = TOKENS.map((t) => {
  const b = new Telegraf(t.trim(), { handlerTimeout: 10000 });
  setupHandlers(b);
  return b;
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

