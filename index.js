// single_text_reaction_bot_fixed.js
require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf");

const TOKENS = process.env.BOT_TOKENS.split(",");
const CHANNEL_ID = process.env.CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID; // sizning ID
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!TOKENS || TOKENS.length === 0) {
  console.error("❌ BOT_TOKENS yo‘q!");
  process.exit(1);
}

// 🔑 Bu yerda owner uchun oxirgi forwardni saqlaymiz
let lastForward = null;

function setupHandlers(bot) {
  // Forward qabul qilish
  bot.on("message", async (ctx, next) => {
    if (ctx.from.id != OWNER_ID) return next();

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

    if (fwdChat && fwdMsgId) {
      if (String(fwdChat.id) !== String(CHANNEL_ID)) {
        return ctx.reply("❌ Bu sozlangan kanal emas.");
      }

      // global saqlab qo‘yamiz
      lastForward = { chatId: fwdChat.id, messageId: fwdMsgId };

      return ctx.reply(
        `🟢 Post qabul qilindi.\nID: ${fwdChat.id}:${fwdMsgId}\nEndi emoji yuboring.`
      );
    }

    return next();
  });

  // Emoji yuborilganda → reaction qo‘yish
  bot.on("text", async (ctx) => {
    if (ctx.from.id != OWNER_ID) return;
    if (!lastForward) return ctx.reply("❌ Avval postni forward qiling.");

    const emoji = ctx.message.text.trim();
    const { chatId, messageId } = lastForward;

    try {
      await bot.telegram.setMessageReaction(
        chatId,
        messageId,
        [{ type: "emoji", emoji }],
        true
      );
      await ctx.reply(`✅ ${emoji} reaksiyasi qo‘yildi!`);
    } catch (err) {
      console.error("❌ Reaction error:", err);
      await ctx.reply("❌ Reaction qo‘yishda xatolik.");
    }
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
        allowed_updates: ["message"],
      });
    });
    app.listen(PORT, () => console.log("🌐 Webhook server on", PORT));
  } else {
    for (const bot of bots) {
      await bot.launch({
        allowedUpdates: ["message"],
      });
      console.log("🤖 Bot started:", (await bot.telegram.getMe()).username);
    }
  }
})();

process.once("SIGINT", () => bots.forEach((b) => b.stop("SIGINT")));
process.once("SIGTERM", () => bots.forEach((b) => b.stop("SIGTERM")));
