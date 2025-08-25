// single_reaction_bot.js
require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const TOKENS = process.env.BOT_TOKENS.split(",");
const CHANNEL_ID = process.env.CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID; // faqat sizning Telegram ID
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!TOKENS || TOKENS.length === 0) {
  console.error("❌ BOT_TOKENS yo‘q!");
  process.exit(1);
}

const EMOJIS = ["👍", "❤️", "🔥", "😂", "😮", "🎉", "👏", "😢"];

function buildEmojiKeyboard() {
  const rows = [];
  for (let i = 0; i < EMOJIS.length; i += 4) {
    rows.push(EMOJIS.slice(i, i + 4).map((e) => Markup.button.callback(e, `emoji:${e}`)));
  }
  return Markup.inlineKeyboard(rows);
}

function setupHandlers(bot) {
  bot.start((ctx) => ctx.reply("Forward qiling va emoji tanlang."));

  bot.on("message", async (ctx) => {
    if (ctx.from.id != OWNER_ID) {
      return ctx.reply("❌ Sizga ruxsat yo‘q.");
    }

    const msg = ctx.message;
    let fwdChat = null;
    let fwdMsgId = null;

    if (msg.forward_from_chat && msg.forward_from_message_id) {
      fwdChat = msg.forward_from_chat;
      fwdMsgId = msg.forward_from_message_id;
    }
    if (msg.forward_origin?.chat && msg.forward_origin?.message_id) {
      fwdChat = msg.forward_origin.chat;
      fwdMsgId = msg.forward_origin.message_id;
    }

    if (!fwdChat || !fwdMsgId) {
      return ctx.reply("❌ Bu forward emas.");
    }
    if (String(fwdChat.id) !== String(CHANNEL_ID)) {
      return ctx.reply("❌ Bu sozlangan kanal emas.");
    }

    // 🔑 Session o‘rniga oddiy contextda saqlaymiz
    ctx.sessionData = { chatId: fwdChat.id, messageId: fwdMsgId };

    await ctx.reply(
      `🟢 Post qabul qilindi.\nID: ${fwdChat.id}:${fwdMsgId}\nEndi qaysi reaksiyani bosish kerak?`,
      buildEmojiKeyboard()
    );
  });

  // 🔑 Emoji tanlash → darrov bosish
  bot.action(/^emoji:(.+)$/, async (ctx) => {
    if (ctx.from.id != OWNER_ID) return ctx.answerCbQuery("❌ Sizga ruxsat yo‘q.");

    const emoji = ctx.match[1];
    const { chatId, messageId } = ctx.sessionData || {};

    if (!chatId || !messageId) {
      return ctx.answerCbQuery("Avval forward qiling!");
    }

    try {
      await bot.telegram.setMessageReaction(
        chatId,
        messageId,
        [{ type: "emoji", emoji }],
        true
      );
      await ctx.editMessageText(`✅ ${emoji} reaksiyasi qo‘yildi!`);
    } catch (err) {
      console.error("❌ Reaction error:", err);
      await ctx.reply("❌ Reaction qo‘yishda xatolik.");
    }
  });
}

// --- Launch barcha botlarni
const bots = TOKENS.map((t) => {
  const b = new Telegraf(t.trim(), { handlerTimeout: 10000 });
  setupHandlers(b);
  return b;
});

(async () => {
  if (WEBHOOK_URL) {
    const app = express();
    bots.forEach((bot) => {
      const path = `/tg/${bot.secretPathComponent()}`;
      app.use(bot.webhookCallback(path));
      bot.telegram.setWebhook(`${WEBHOOK_URL}${path}`, {
        allowed_updates: ["message", "callback_query"],
      });
    });
    app.listen(PORT, () => console.log("🌐 Webhook server on", PORT));
  } else {
    for (const bot of bots) {
      await bot.launch({
        allowedUpdates: ["message", "callback_query"],
      });
      console.log("🤖 Bot started:", (await bot.telegram.getMe()).username);
    }
  }
})();

process.once("SIGINT", () => bots.forEach((b) => b.stop("SIGINT")));
process.once("SIGTERM", () => bots.forEach((b) => b.stop("SIGTERM")));
