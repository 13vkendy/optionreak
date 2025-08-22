// reaction_bot.js
require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // -100...
const WEBHOOK_URL = process.env.WEBHOOK_URL; // agar Render/Webhook ishlatadigan bo'lsangiz

if (!BOT_TOKEN) {
  console.error('Error: BOT_TOKEN .env da yoq');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 10000 });
// agar pollingda ishlasangiz, launch() ga allowedUpdates beramiz (quyi qismda)
bot.use(session());

// --- In-memory store ---
// monitors: key = `${chatId}:${messageId}`
// value = { ownerId, chatId, messageId, reactions: ['👍','❤️'], threshold: number, lastCounts: {emoji:count} }
const monitors = new Map();

// --- Emoji tanlovi (siz istagancha qo'shing) ---
const EMOJIS = ['👍','❤️','🔥','😂','😮','🎉','👏','😢'];

// --- Helpers ---
function mkKey(chatId, messageId) { return `${chatId}:${messageId}`; }
function prettyList(arr){ return arr && arr.length ? arr.join(' ') : '(hech narsa)'; }

function buildEmojiKeyboard(selected = []) {
  // show emojis as toggle buttons + Done
  const rows = [];
  for (let i = 0; i < EMOJIS.length; i += 4) {
    const row = EMOJIS.slice(i, i+4).map(e => {
      const picked = selected.includes(e) ? `✅ ${e}` : e;
      return Markup.button.callback(picked, `emoji_toggle:${e}`);
    });
    rows.push(row);
  }
  rows.push([ Markup.button.callback('✅ Tayyor', 'emoji_done') ]);
  rows.push([ Markup.button.callback('❌ Bekor qilish', 'emoji_cancel') ]);
  return Markup.inlineKeyboard(rows);
}

function buildThresholdKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('1', 'thr:1'), Markup.button.callback('3', 'thr:3'), Markup.button.callback('5', 'thr:5')],
    [Markup.button.callback('10', 'thr:10'), Markup.button.callback('Custom...', 'thr:custom')],
    [Markup.button.callback('❌ Bekor', 'thr:cancel')]
  ]);
}

// --- Start / help ---
bot.start(async (ctx) => {
  await ctx.reply(
    'Salom! Kanal postini forward qilib menga yuboring, so‘ng sizdan qaysi reaksiyalarni kuzatishni xohlayotganingizni so‘rayman.\n\n' +
    'Jarayon: forward ➜ emoji tanlash ➜ threshold (nechta bosish) ➜ tasdiq ➜ men monitoring qilaman.\n\n' +
    'Boshlash uchun kanaldagi postni botga forward qiling.'
  );
});

// --- 1) Qabul: kanal postini forward qilish ---
bot.on('message', async (ctx) => {
  const msg = ctx.message;

  // 🔑 Agar session bo'sh bo'lsa, bosh obyekt qilib qo'yamiz
  if (!ctx.session) ctx.session = {};

  let fwdChat = null;
  let fwdMsgId = null;

  try {
    // Eski forward usuli
    if (msg.forward_from_chat && msg.forward_from_message_id) {
      fwdChat = msg.forward_from_chat;
      fwdMsgId = msg.forward_from_message_id;
    }

    // Yangi forward usuli
    if (!fwdChat && msg.forward_origin?.chat && msg.forward_origin?.message_id) {
      fwdChat = msg.forward_origin.chat;
      fwdMsgId = msg.forward_origin.message_id;
    }

    if (!fwdChat || !fwdMsgId) {
      return ctx.reply('❌ Bu forward emas. Kanal postini forward qiling.');
    }

    // Kanalni tekshirish
    if (
      String(fwdChat.id) !== String(CHANNEL_ID) &&
      String(fwdChat.username || '') !== String(CHANNEL_ID).replace('@','')
    ) {
      return ctx.reply('❌ Bu sozlangan kanal emas. To‘g‘ri kanal postini yuboring.');
    }

    // 🔑 Endi sessionga bemalol yozamiz
    ctx.session.monitor = {
      ownerId: ctx.from.id,
      chatId: fwdChat.id,
      messageId: fwdMsgId,
      reactions: [],
      threshold: null
    };

    await ctx.reply(
      `🟢 Post qabul qilindi.\nID: ${fwdChat.id}:${fwdMsgId}\nEndi qaysi reaksiyalarni kuzatmoqchisiz?`,
      buildEmojiKeyboard(ctx.session.monitor.reactions)
    );
  } catch (err) {
    console.error("❌ Forward handler error:", err);
    return ctx.reply("Xatolik yuz berdi. Loglarni tekshirib ko‘ring.");
  }
});

// --- 2) Emoji toggle / done / cancel ---
bot.action(/^emoji_toggle:(.+)$/, async (ctx) => {
  const emoji = ctx.match[1];
  if (!ctx.session?.monitor || ctx.from.id !== ctx.session.monitor.ownerId) {
    await ctx.answerCbQuery('Avval postni forward qiling!');
    return;
  }
  const arr = ctx.session.monitor.reactions || [];
  if (arr.includes(emoji)) {
    ctx.session.monitor.reactions = arr.filter(e => e !== emoji);
  } else {
    ctx.session.monitor.reactions = [...arr, emoji];
  }
  // Update message to show new selection
  await ctx.editMessageText(
    `🟢 Post qabul qilindi.\nID: ${ctx.session.monitor.chatId}:${ctx.session.monitor.messageId}\nEndi qaysi reaksiyalarni kuzatmoqchisiz?\nTanlangan: ${prettyList(ctx.session.monitor.reactions)}`,
    buildEmojiKeyboard(ctx.session.monitor.reactions)
  );
  await ctx.answerCbQuery();
});

bot.action('emoji_done', async (ctx) => {
  if (!ctx.session?.monitor || ctx.from.id !== ctx.session.monitor.ownerId) {
    await ctx.answerCbQuery('Avval postni forward qiling!');
    return;
  }
  if (!ctx.session.monitor.reactions.length) {
    await ctx.answerCbQuery('Hech qanday emoji tanlanmadi!');
    return;
  }
  // So'ng threshold so'raymiz
  await ctx.editMessageText(
    `✅ Tanlangan: ${prettyList(ctx.session.monitor.reactions)}\nEndi har bir reaktsiya uchun trigger (nechta bosilganda action bo'lsin) tanlang:`,
    buildThresholdKeyboard()
  );
  await ctx.answerCbQuery();
});

bot.action('emoji_cancel', async (ctx) => {
  ctx.session.monitor = null;
  await ctx.editMessageText('❌ Jarayon bekor qilindi. Yangi postni forward qiling yoki /start bosing.');
  await ctx.answerCbQuery();
});

// --- 3) Threshold tanlash ---
bot.action(/^thr:(.+)$/, async (ctx) => {
  const v = ctx.match[1];
  if (!ctx.session?.monitor) {
    await ctx.answerCbQuery('Avval postni forward qiling!');
    return;
  }
  if (v === 'cancel') {
    ctx.session.monitor = null;
    await ctx.editMessageText('❌ Jarayon bekor qilindi.');
    await ctx.answerCbQuery();
    return;
  }
  if (v === 'custom') {
    await ctx.editMessageText('Iltimos, kerakli sonni raqam sifatida yozing (masalan: 10).');
    await ctx.answerCbQuery();
    // bot keyingi matnli xabarni threshold sifatida qabul qiladi
    ctx.session.awaitingCustomThreshold = true;
    return;
  }
  // numeric
  const thr = parseInt(v, 10) || 1;
  ctx.session.monitor.threshold = thr;
  // confirmation
  await ctx.editMessageText(
    `👀 Monitoring sozlandi:\nPost: ${ctx.session.monitor.chatId}:${ctx.session.monitor.messageId}\nReaksiyalar: ${prettyList(ctx.session.monitor.reactions)}\nTrigger: ${thr}\n\nTasdiqlaysizmi?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📌 Tasdiqlash va qoʻshish', 'confirm_monitor')],
      [Markup.button.callback('❌ Bekor qilish', 'cancel_monitor')]
    ])
  );
  await ctx.answerCbQuery();
});

// handle custom threshold input (text)
bot.on('text', async (ctx) => {
  if (ctx.session?.awaitingCustomThreshold && ctx.session?.monitor) {
    const num = parseInt(ctx.message.text.trim(), 10);
    ctx.session.awaitingCustomThreshold = false;
    if (!num || num <= 0) {
      return ctx.reply('Noto‘g‘ri qiymat. Iltimos musbat butun son yozing.');
    }
    ctx.session.monitor.threshold = num;
    await ctx.reply(
      `✅ Threshold ${num} ga o‘rnatildi.\nEndi tasdiqlang:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📌 Tasdiqlash va qoʻshish', 'confirm_monitor')],
        [Markup.button.callback('❌ Bekor qilish', 'cancel_monitor')]
      ])
    );
  }
});

// --- 4) Confirm / Cancel monitor ---
bot.action('cancel_monitor', async (ctx) => {
  ctx.session.monitor = null;
  await ctx.answerCbQuery('Bekor qilindi.');
  await ctx.editMessageText('❌ Jarayon bekor qilindi.');
});

bot.action('confirm_monitor', async (ctx) => {
  if (!ctx.session?.monitor) {
    await ctx.answerCbQuery('Avval postni forward qiling!');
    return;
  }
  const m = ctx.session.monitor;
  const key = mkKey(m.chatId, m.messageId);
  m.ownerId = ctx.from.id;
  m.lastCounts = {}; // init
  monitors.set(key, m);

  // **Note**: Telegram Bot API usually allows bot to set only 1 reaction (non-premium).
  // We will set the first chosen emoji as bot's own reaction (if any).
  try {
    const reactionToSet = m.reactions[0];
    if (reactionToSet) {
      // telegraf wrapper: telegram.setMessageReaction(chat_id, message_id, reaction?, is_big?)
      await bot.telegram.setMessageReaction(
      m.chatId,
      m.messageId,
      [{ type: 'emoji', emoji: reactionToSet }], // ✅ to‘g‘ri format
      true
    );
    }
  } catch (e) {
    console.error('setMessageReaction error', e);
    // continue even if setting reaction failed (maybe bot not admin or API restriction)
  }

  await ctx.editMessageText(
    `✅ Monitoring boshlangan!\nPost: ${m.chatId}:${m.messageId}\nReaksiyalar: ${prettyList(m.reactions)}\nTrigger: ${m.threshold}\n\nMen postni kuzataman. Siz /monitors bilan ro'yxatni ko‘rishingiz mumkin.`,
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery();
  // clear session builder
  ctx.session.monitor = null;
});

// --- 5) Reaction updates (Telegram will send these when allowed_updates includes them) ---
bot.on('message_reaction', async (ctx) => {
  try {
    // Debug/log (yoqish uchun): console.log('message_reaction update', JSON.stringify(ctx.update).slice(0,400));
    const ur = ctx.update.message_reaction;
    const msg = ur?.message || ur?.message?.message; // try variants
    if (!msg) return;
    const chatId = msg.chat?.id || msg.chat_id;
    const messageId = msg.message_id || msg.message?.message_id || msg.id;
    const key = mkKey(chatId, messageId);
    if (!monitors.has(key)) return;

    const mon = monitors.get(key);
    // attempt to read counts from ctx.reactions (telegraf helper) or update object
    const counts = {};
    if (ctx.reactions && typeof ctx.reactions === 'object') {
      // ctx.reactions is a helper: try to iterate EMOJIS
      for (const e of mon.reactions) {
        try {
          counts[e] = (ctx.reactions.get ? (ctx.reactions.get(e)?.count || 0) : (ctx.reactions.has ? (ctx.reactions.has(e) ? 1 : 0) : 0));
        } catch { counts[e] = 0; }
      }
    } else if (ur.reactions) {
      for (const r of ur.reactions) {
        const emoji = r.emoji || r.type || r.reaction;
        counts[emoji] = r.count || r.total_count || 0;
      }
    }
    mon.lastCounts = counts;
    // check thresholds
    for (const e of mon.reactions) {
      const c = counts[e] || 0;
      if (mon.threshold && c >= mon.threshold) {
        // Trigger: notify owner and optionally post to channel
        try {
          // notify owner in private
          await bot.telegram.sendMessage(mon.ownerId, `🎯 Threshold yetildi!\nPost: ${chatId}:${messageId}\nEmoji: ${e}\nCount: ${c} (threshold: ${mon.threshold})`);
          // optionally post to channel (masalan, reply)
          await bot.telegram.sendMessage(chatId, `✅ @${(await bot.telegram.getMe()).username} e'lon qiladi: ${e} reaction ${c} tag `, {reply_to_message_id: messageId});
        } catch (err) {
          console.error('notify error', err);
        }
        // remove monitor after trigger (agar xohlasangiz, saqlab qolish ham mumkin)
        monitors.delete(key);
        break;
      }
    }
  } catch (e) {
    console.error('message_reaction handler error', e);
  }
});

// Also listen message_reaction_count (grouped updates)
bot.on('message_reaction_count', async (ctx) => {
  // same handling as above; reuse by calling the above handler
  try {
    // re-use code: call message_reaction handler function by crafting pseudo ctx
    await bot.handleUpdate(ctx.update); // not ideal but ensures we process update; simpler: call same logic:
    // fallback: we simply run same logic body by reusing ctx (since update has message_reaction_count field)
    // For brevity we call the same processing as message_reaction:
    // (above handler expects ctx.update.message_reaction; message_reaction_count shape similar)
    const ur = ctx.update.message_reaction_count;
    const msg = ur?.message || ur?.message?.message;
    if (!msg) return;
    const chatId = msg.chat?.id || msg.chat_id;
    const messageId = msg.message_id || msg.message?.message_id || msg.id;
    const key = mkKey(chatId, messageId);
    if (!monitors.has(key)) return;
    const mon = monitors.get(key);
    const counts = {};
    if (ur.reactions) {
      for (const r of ur.reactions) {
        const emoji = r.emoji || r.type || r.reaction;
        counts[emoji] = r.count || r.total_count || 0;
      }
    }
    mon.lastCounts = counts;
    for (const e of mon.reactions) {
      const c = counts[e] || 0;
      if (mon.threshold && c >= mon.threshold) {
        await bot.telegram.sendMessage(mon.ownerId, `🎯 Threshold yetildi!\nPost: ${chatId}:${messageId}\nEmoji: ${e}\nCount: ${c} (threshold: ${mon.threshold})`);
        await bot.telegram.sendMessage(chatId, `✅ @${(await bot.telegram.getMe()).username} e'lon qiladi: ${e} reaction ${c} tag`, {reply_to_message_id: messageId});
        monitors.delete(key);
        break;
      }
    }
  } catch (e) {
    console.error('message_reaction_count handler error', e);
  }
});

// --- Utility commands ---
// /monitors - list active monitors (owner only will see their monitors)
bot.command('monitors', async (ctx) => {
  const userId = ctx.from.id;
  const list = [];
  for (const [k, m] of monitors.entries()) {
    if (m.ownerId === userId) {
      list.push(`${k} — ${prettyList(m.reactions)} — thr: ${m.threshold} — last: ${JSON.stringify(m.lastCounts||{})}`);
    }
  }
  if (!list.length) return ctx.reply('Sizda faollashgan monitorlar yo‘q.');
  await ctx.reply('Sizning monitorlaringiz:\n' + list.join('\n\n'));
});

// /cancel <chatId:messageId> - cancel a monitor
bot.command('cancelmonitor', async (ctx) => {
  const text = ctx.message.text || '';
  const parts = text.split(' ');
  if (parts.length < 2) return ctx.reply('Foydalanish: /cancelmonitor <chatId:messageId>');
  const key = parts[1].trim();
  if (!monitors.has(key)) return ctx.reply('Bunday monitor topilmadi.');
  const mon = monitors.get(key);
  if (mon.ownerId !== ctx.from.id) return ctx.reply('Faqat monitor egasi bekor qilishi mumkin.');
  monitors.delete(key);
  await ctx.reply('Monitor bekor qilindi.');
});

// --- Launch (polling or webhook) ---
// IMPORTANT: include allowedUpdates to receive reactions
const app = express();
app.get('/', (req, res) => res.send('ok'));

(async () => {
  try {
    if (WEBHOOK_URL) {
      // Webhook mode (Render)
      const path = `/tg/${bot.secretPathComponent()}`;
      // set webhook with allowed_updates
      await bot.telegram.setWebhook(`${WEBHOOK_URL}${path}`, { allowed_updates: ['message', 'callback_query', 'message_reaction', 'message_reaction_count'] });
      app.use(bot.webhookCallback(path));
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => console.log('🌐 Webhook server on', PORT));
      console.log('Webhook configured with allowed_updates');
    } else {
      // Polling mode
      await bot.launch({ allowedUpdates: ['message', 'callback_query', 'message_reaction', 'message_reaction_count'] });
      console.log('🤖 Bot started (long polling) with reaction updates enabled');
    }
  } catch (err) {
    console.error('Launch error', err);
    process.exit(1);
  }
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));



