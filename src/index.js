require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, REST, Routes,
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, AttachmentBuilder
} = require('discord.js');
const {
  listTickets, saveTicket, findOpenTicket, nextTicketNumber, closeTicket, getSettings, updateSettings
} = require('./store');

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'SESSION_SECRET'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) console.warn(`Eksik .env değişkenleri: ${missing.join(', ')}`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent
  ]
});
const app = express();
const port = Number(process.env.PORT || 3000);
const defaultCategoryName = process.env.TICKET_CATEGORY_NAME || 'Tickets';
const logoAttachmentPath = path.join(__dirname, '..', 'public', 'orlin-mark.png');

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'development-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 } }));
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const expected = req.session.csrfToken;
  const supplied = req.body?._csrf;
  if (!expected || typeof supplied !== 'string' || supplied.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).send('İstek doğrulanamadı. Sayfayı yenileyip tekrar dene.');
  }
  return next();
});

function requireAuth(req, res, next) { if (!req.session.user) return res.redirect('/'); next(); }
function ownerGuildFor(req, guildId) {
  const guild = client.guilds.cache.get(guildId);
  return guild?.ownerId === req.session.user.id ? guild : null;
}
function dashboardData(req) {
  req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
  const guilds = client.guilds.cache.filter((guild) => guild.ownerId === req.session.user.id);
  const guildIds = new Set(guilds.keys());
  return {
    user: req.session.user, guilds: [...guilds.values()], tickets: listTickets().filter((ticket) => guildIds.has(ticket.guildId)),
    settingsFor, channelType: ChannelType, csrfToken: req.session.csrfToken, query: req.query
  };
}
function isOwner(interaction) { return interaction.guild?.ownerId === interaction.user.id; }
function isModerator(interaction) {
  const configuredRole = interaction.guild && settingsFor(interaction.guild).moderatorRoleId;
  const roles = interaction.member?.roles;
  const hasConfiguredRole = configuredRole && (roles?.cache?.has(configuredRole) || Array.isArray(roles) && roles.includes(configuredRole));
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || hasConfiguredRole || isOwner(interaction);
}
function deny(interaction, text) { return interaction.reply({ content: `Bu işlem için yetkin yok. ${text || ''}`, flags: MessageFlags.Ephemeral }); }
function brandedMessage(payload) {
  return {
    ...payload,
    embeds: payload.embeds.map((embed) => embed.setThumbnail('attachment://orlin-mark.png')),
    files: [...(payload.files || []), new AttachmentBuilder(logoAttachmentPath, { name: 'orlin-mark.png' })]
  };
}
async function checkModerationTarget(interaction, target) {
  if (!isModerator(interaction)) return 'Bu işlem için moderatör yetkisi gerekiyor.';
  if (target.id === interaction.guild.ownerId) return 'Sunucu sahibine bu işlem uygulanamaz.';
  if (target.id === interaction.user.id) return 'Bu işlemi kendine uygulayamazsın.';
  const [actor, bot] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    Promise.resolve(interaction.guild.members.me)
  ]);
  if (actor.id !== interaction.guild.ownerId && target.roles.highest.comparePositionTo(actor.roles.highest) >= 0) {
    return 'Rolü seninle aynı veya daha yüksek olan üyeye işlem uygulayamazsın.';
  }
  if (!bot || target.roles.highest.comparePositionTo(bot.roles.highest) >= 0) {
    return 'Botun rolü hedef üyenin rollerinden yüksek olmalı.';
  }
  return null;
}
function auditReason(interaction, reason) {
  return `${interaction.user.tag}: ${reason?.trim() || 'Sebep belirtilmedi.'}`.slice(0, 512);
}
function settingsFor(guild) { return { categoryId: null, categoryName: defaultCategoryName, moderatorRoleId: process.env.TICKET_SUPPORT_ROLE_ID || null, ticketRoleId: null, welcomeChannelId: null, goodbyeChannelId: null, goodbyeMessage: 'Yolun açık olsun, {takma_ad}!', moderationLogChannelId: null, autoRoleId: null, vanityAllowedRoleIds: [], ...getSettings(guild.id) }; }
function helpEmbed() {
  return new EmbedBuilder().setColor(0xffc000).setTitle('Kontrol Merkezi').setDescription('Aşağıdaki menüden komut grubunu seç veya doğrudan slash komutlarını kullan.').addFields(
    { name: 'Ticket', value: '`/ticket` veya `/ticket-panel` panel gönderir\n`/ticket-kapat` açık ticketı kapatır\n`/ticket-ekle` kullanıcı ekler\n`/ticket-cikar` kullanıcı çıkarır' },
    { name: 'Moderasyon', value: '`/timeout` ve `/timeout-kaldir`\n`/ban`, `/ban-kaldir` (kullanici_id), `/kick`\n`/ses-sustur`, `/ses-susturma-kaldir`\n`/sagirlestir`, `/sagirliligi-kaldir`\n`/sil`, `/kanal-sil`, rol ve kategori işlemleri' },
    { name: 'Sunucu ayarları', value: '`/ayar kategori` ticket kategorisi\n`/ayar destek-rolu` moderatör rolü\n`/ayar ticket-rolu` ticket açan rolü\n`/ayar hosgeldin` ve `/ayar ayrilma` kanalları\n`/ayar ayrilma-mesaji` ayrılış afişi metni\nMesajlarda `{kullanici}`, `{takma_ad}`, `{sunucu}`, `{uye_sayisi}` kullanılabilir.\n`/ayar moderasyon-logu` işlem kayıt kanalı\n`/ayar otomatik-rol` yeni üyeye rol\n`/ayar vanity-rol-ekle` URL değiştirme izni\n`/ayar vanity-rol-cikar` URL iznini kaldırır\nWeb panelinden giriş/çıkış ve moderasyon log kanallarını da seçebilirsin.' },
    { name: 'Bilgi', value: '`/sunucu-bilgi` sunucu bilgisi\n`/panel` web paneli\n`/yardim` bu menü' }
  ).setFooter({ text: 'ORLIN • Yetki ayarlarını yalnızca sunucu sahibi yapabilir.' });
}
function helpComponents() {
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help-menu').setPlaceholder('Komut grubunu seç').addOptions(
    { label: 'Ticket komutları', value: 'ticket', emoji: '🎫' },
    { label: 'Moderasyon komutları', value: 'moderation', emoji: '🛡️' },
    { label: 'Sunucu ayarları', value: 'settings', emoji: '⚙️' },
    { label: 'Tüm komutlar', value: 'all', emoji: '📚' }
  ))];
}
function ticketPanelComponents() { return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket-open').setLabel('Ticket aç').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]; }
function ticketCreationModal() {
  return new ModalBuilder().setCustomId('ticket-create').setTitle('Destek talebi oluştur').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticket-subject').setLabel('Talebinin konusu').setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(100).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ticket-details').setLabel('Nasıl yardımcı olabiliriz?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000).setRequired(true))
  );
}
function mainPanelComponents() { return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel-ticket').setLabel('Ticket paneli').setStyle(ButtonStyle.Primary).setEmoji('🎫'), new ButtonBuilder().setCustomId('panel-help').setLabel('Komutlar').setStyle(ButtonStyle.Secondary).setEmoji('📚'))]; }
function ticketEmbed() { return new EmbedBuilder().setColor(0xffc000).setTitle('Destek Merkezi').setDescription('Destek talebi oluşturmak için aşağıdaki düğmeye bas. Kısa bir konu ve açıklama istenecek; ekibimiz yalnızca senin ve yetkililerin görebildiği bir ticket kanalı açacak.'); }
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}
function posterMessageLines(message) {
  const cleaned = String(message).replace(/\s+/g, ' ').trim();
  const clipped = Array.from(cleaned).slice(0, 114).join('');
  const words = clipped.split(' ').flatMap((word) => (
    word.length > 38 ? word.match(/.{1,38}/gu) : [word]
  ));
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 38 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = `${lines[2].slice(0, 34)}…`;
  } else if (Array.from(cleaned).length > 114 && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, 34)}…`;
  }
  return lines.map((line, index) => `<tspan x="104" dy="${index ? 43 : 0}">${escapeXml(line)}</tspan>`).join('');
}
function welcomeMessageFor(member, joined) {
  const settings = settingsFor(member.guild);
  const template = joined ? 'Aramıza hoş geldin, {takma_ad}!' : settings.goodbyeMessage;
  return String(template).replace(/\{(kullanici|takma_ad|sunucu|uye_sayisi)\}/g, (token, key) => ({
    '{kullanici}': member.user.username,
    '{takma_ad}': member.displayName,
    '{sunucu}': member.guild.name,
    '{uye_sayisi}': String(member.guild.memberCount)
  })[token] || key);
}
function neonWelcomeCard(member, joined, message) {
  const accent = joined ? '#ffc000' : '#ff8f83';
  const username = escapeXml(member.user.username.slice(0, 40));
  const nickname = escapeXml(member.displayName.slice(0, 40));
  const guildName = escapeXml(member.guild.name.slice(0, 42));
  const memberCount = member.guild.memberCount.toLocaleString('tr-TR');
  const createdAt = new Date(member.user.createdTimestamp).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  const joinedAt = member.joinedAt?.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) || 'Bilinmiyor';
  const messageLines = posterMessageLines(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="620" viewBox="0 0 1400 620"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101923"/><stop offset=".58" stop-color="#1a2935"/><stop offset="1" stop-color="#263845"/></linearGradient><linearGradient id="accentGlow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}" stop-opacity=".2"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs><rect width="1400" height="620" rx="32" fill="url(#bg)"/><circle cx="1250" cy="30" r="390" fill="url(#accentGlow)"/><path d="M0 575 C300 515 460 630 760 555 S1160 495 1400 535" fill="none" stroke="${accent}" stroke-opacity=".28" stroke-width="2"/><rect x="28" y="28" width="1344" height="564" rx="24" fill="none" stroke="#fff" stroke-opacity=".12"/><rect x="82" y="82" width="6" height="44" rx="3" fill="${accent}"/><text x="108" y="112" font-family="Arial,sans-serif" font-size="17" font-weight="700" letter-spacing="3" fill="${accent}">${joined ? 'HOŞ GELDİN' : 'GÖRÜŞMEK ÜZERE'}</text><text x="104" y="194" font-family="Arial,sans-serif" font-size="43" font-weight="750" fill="#f5f7fa">${messageLines}</text><text x="104" y="359" font-family="Arial,sans-serif" font-size="29" font-weight="700" fill="#f5f7fa">${nickname}</text><text x="104" y="399" font-family="Arial,sans-serif" font-size="19" fill="#bdcbd4">@${username}</text><text x="104" y="459" font-family="Arial,sans-serif" font-size="17" fill="#d6e0e6">${guildName}  ·  ${memberCount} üye</text><text x="104" y="505" font-family="Arial,sans-serif" font-size="15" fill="#9cabb5">Hesap: ${escapeXml(createdAt)}</text><text x="104" y="535" font-family="Arial,sans-serif" font-size="15" fill="#9cabb5">${joined ? 'Katılım' : 'Sunucuya katılım'}: ${escapeXml(joinedAt)}</text><circle cx="1115" cy="309" r="174" fill="#111b24" stroke="${accent}" stroke-opacity=".8" stroke-width="5"/><circle cx="1115" cy="309" r="160" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="1"/></svg>`;
}
async function neonWelcomeImage(member, joined, message) {
  const card = await sharp(Buffer.from(neonWelcomeCard(member, joined, message))).png().toBuffer();
  const logo = await sharp(logoAttachmentPath).resize(96, 96).png().toBuffer();
  const avatarMask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="150" fill="white"/></svg>');
  let avatar;
  try {
    const avatarResponse = await fetch(member.user.displayAvatarURL({ extension: 'png', size: 512 }));
    if (!avatarResponse.ok) throw new Error(`HTTP ${avatarResponse.status}`);
    avatar = await sharp(Buffer.from(await avatarResponse.arrayBuffer()))
      .resize(300, 300, { fit: 'cover' })
      .composite([{ input: avatarMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch (error) {
    console.error(`Afiş için profil fotoğrafı alınamadı (${member.user.id}); varsayılan avatar kullanılacak:`, error.message);
    const initial = escapeXml(Array.from(member.displayName)[0] || '?');
    avatar = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="150" fill="#263845"/><text x="150" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="120" font-weight="700" fill="#f5f7fa">${initial}</text></svg>`))
      .png()
      .toBuffer();
  }
  return sharp(card).composite([{ input: avatar, left: 965, top: 160 }, { input: logo, left: 1270, top: 30 }]).png().toBuffer();
}
async function logModerationAction(guild, actor, action, details) {
  const channelId = settingsFor(guild).moderationLogChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch((error) => {
    console.error(`Moderasyon log kanalı alınamadı (${guild.name}):`, error.message);
    return null;
  });
  if (!channel?.isTextBased()) {
    console.error(`Moderasyon log kanalı geçersiz veya metin kanalı değil: ${channelId} (${guild.name})`);
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0xffc000)
    .setTitle('Moderasyon işlemi')
    .addFields(
      { name: 'İşlem', value: action, inline: true },
      { name: 'Yetkili', value: `${actor.tag || actor.username || actor.id} (\`${actor.id}\`)`, inline: true },
      { name: 'Detay', value: String(details).slice(0, 1024) || 'Detay belirtilmedi.' }
    )
    .setTimestamp();
  await channel.send(brandedMessage({ embeds: [embed] })).catch((error) => {
    console.error(`Moderasyon işlemi loglanamadı (${guild.name}):`, error.message);
  });
}

app.get('/', (req, res) => res.render('home', { user: req.session.user, botReady: client.isReady() }));
app.get('/auth/login', (req, res) => { const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify guilds' }); res.redirect(`https://discord.com/oauth2/authorize?${params}`); });
app.get('/auth/callback', async (req, res) => {
  try {
    const response = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: process.env.DISCORD_REDIRECT_URI }) });
    const token = await response.json(); if (!token.access_token) throw new Error('OAuth token alınamadı');
    const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    req.session.user = await userResponse.json(); res.redirect('/dashboard');
  } catch (error) { console.error(error); res.status(500).render('error', { message: 'Discord girişi tamamlanamadı.' }); }
});
app.get('/auth/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/dashboard', requireAuth, (req, res) => res.render('dashboard', dashboardData(req)));
app.post('/guilds/:guildId/settings', requireAuth, async (req, res) => {
  const guild = ownerGuildFor(req, req.params.guildId);
  if (!guild) return res.status(403).send('Bu sunucunun sahibi değilsin.');
  const channelSettings = [
    ['welcomeChannelId', req.body.welcomeChannelId],
    ['goodbyeChannelId', req.body.goodbyeChannelId],
    ['moderationLogChannelId', req.body.moderationLogChannelId]
  ];
  const changes = {};
  for (const [setting, channelId] of channelSettings) {
    if (!channelId) {
      changes[setting] = null;
      continue;
    }
    if (typeof channelId !== 'string' || !/^\d{17,20}$/.test(channelId)) {
      return res.status(400).send('Geçersiz kanal seçimi.');
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return res.status(400).send('Seçilen kanallardan biri bu sunucuya ait geçerli bir metin kanalı değil.');
    }
    changes[setting] = channel.id;
  }
  updateSettings(guild.id, changes);
  await logModerationAction(guild, req.session.user, 'Panel ayarlarını güncelleme', 'Karşılama, ayrılma ve moderasyon log kanalları güncellendi.');
  res.redirect(`/dashboard?ok=${encodeURIComponent(`${guild.name} sunucu ayarları kaydedildi`)}`);
});
app.post('/guilds/:guildId/channels', requireAuth, async (req, res) => {
  try {
    const guild = ownerGuildFor(req, req.params.guildId);
    if (!guild) return res.status(403).send('Bu sunucunun sahibi değilsin.');
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return res.status(403).send('Botun kanal yönetme yetkisi yok.');
    const channel = await guild.channels.create({ name: req.body.name?.trim() || 'yeni-kanal', type: ChannelType.GuildText, topic: req.body.topic?.trim() || undefined });
    res.redirect(`/dashboard?ok=${encodeURIComponent(`${channel.name} kanalı oluşturuldu`)}`);
  } catch (error) { console.error(error); res.status(500).send('Kanal oluşturulamadı.'); }
});
app.post('/guilds/:guildId/invites', requireAuth, async (req, res) => {
  try {
    const guild = ownerGuildFor(req, req.params.guildId);
    const botMember = guild?.members.me;
    if (!guild) return res.status(403).send('Bu sunucunun sahibi değilsin.');
    if (!botMember?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) return res.status(403).send('Botun davet oluşturma yetkisi yok.');
    const channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.permissionsFor(botMember)?.has(PermissionFlagsBits.CreateInstantInvite));
    if (!channel) return res.status(403).send('Davet oluşturulacak uygun kanal bulunamadı.');
    const invite = await channel.createInvite({ maxAge: 86400, maxUses: 0, unique: true, reason: `Panel kullanıcısı: ${req.session.user.username}` });
    const recipient = await client.users.fetch(req.session.user.id);
    await recipient.send(`Sunucu davet bağlantın (24 saat geçerli): ${invite.url}`);
    res.redirect(`/dashboard?ok=${encodeURIComponent('Davet bağlantısı DM olarak gönderildi')}`);
  } catch (error) { console.error(error); res.status(500).send('Davet oluşturulamadı veya DM gönderilemedi.'); }
});
app.post('/tickets/:id/close', requireAuth, async (req, res) => {
  const ticket = listTickets().find((item) => item.id === req.params.id);
  const guild = ticket && ownerGuildFor(req, ticket.guildId);
  if (!ticket || !guild) return res.status(404).send('Ticket bulunamadı veya bu sunucuyu yönetme yetkin yok.');
  const channel = await guild.channels.fetch(ticket.channelId).catch((error) => {
    console.error(`Panel ticket kanalı alınamadı (${ticket.id}):`, error.message);
    return null;
  });
  if (!channel) return res.status(409).send('Ticket kanalı bulunamadı; kayıt değiştirilmedi.');
  try {
    await closeTicketChannel(channel, req.session.user);
    res.redirect(`/dashboard?ok=${encodeURIComponent(`Ticket #${ticket.number} kapatıldı`)}`);
  } catch (error) {
    console.error(`Panel ticketı kapatılamadı (${ticket.id}):`, error.message);
    res.status(500).send('Ticket kapatılamadı.');
  }
});

async function ensureTicketCategory(guild) {
  const settings = settingsFor(guild);
  let category = settings.categoryId ? guild.channels.cache.get(settings.categoryId) : null;
  if (!category) category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === settings.categoryName);
  if (!category) category = await guild.channels.create({ name: settings.categoryName, type: ChannelType.GuildCategory });
  if (settings.categoryId !== category.id) updateSettings(guild.id, { categoryId: category.id });
  return category;
}
async function createTicket(guild, user, subject, details) {
  const existing = findOpenTicket(guild.id, user.id);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.channelId);
    if (existingChannel) return { existing, channel: existingChannel };
    closeTicket(existing.id, 'Kanal bulunamadı');
  }
  const number = nextTicketNumber(guild.id);
  const category = await ensureTicketCategory(guild);
  const ticketSettings = settingsFor(guild);
  const moderatorRole = ticketSettings.moderatorRoleId
    ? await guild.roles.fetch(ticketSettings.moderatorRoleId).catch(() => null)
    : null;
  if (ticketSettings.moderatorRoleId && !moderatorRole) {
    console.warn(`Geçersiz destek rolü temizlendi: ${ticketSettings.moderatorRoleId}`);
    updateSettings(guild.id, { moderatorRoleId: null });
  }
  const ticketRole = ticketSettings.ticketRoleId
    ? await guild.roles.fetch(ticketSettings.ticketRoleId).catch(() => null)
    : null;
  if (ticketSettings.ticketRoleId && !ticketRole) {
    console.warn(`Geçersiz ticket rolü temizlendi: ${ticketSettings.ticketRoleId}`);
    updateSettings(guild.id, { ticketRoleId: null });
  }
  const channel = await guild.channels.create({ name: `ticket-${String(number).padStart(4, '0')}`, type: ChannelType.GuildText, parent: category.id, topic: `Ticket #${number} | ${user.tag} (${user.id}) | ${subject}`, permissionOverwrites: [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ...(moderatorRole ? [{ id: moderatorRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
  ] });
  if (ticketRole) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.add(ticketRole).catch((error) => console.error('Ticket rolü verilemedi:', error.message));
  }
  const embed = new EmbedBuilder().setColor(0xffc000).setTitle(`Ticket #${number} · ${subject}`)
    .setDescription(details)
    .addFields({ name: 'Açan', value: `<@${user.id}>`, inline: true }, { name: 'Durum', value: 'Açık', inline: true })
    .setTimestamp();
  try {
    await channel.send(brandedMessage({ content: `<@${user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket-close').setLabel('Ticket kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒'))] }));
  } catch (error) {
    await channel.delete('Ticket kurulumu tamamlanamadı').catch((deleteError) => console.error('Kurulamayan ticket kanalı silinemedi:', deleteError.message));
    throw error;
  }
  const ticket = saveTicket({ id: `${guild.id}-${number}`, number, guildId: guild.id, channelId: channel.id, userId: user.id, userTag: user.tag, subject, details, status: 'open', createdAt: new Date().toISOString() });
  await logModerationAction(guild, user, 'Ticket açma', `Ticket #${number}: ${subject} (kanal: #${channel.name})`);
  return { ticket, channel };
}
async function closeTicketChannel(channel, actor) {
  const ticket = listTickets().find((item) => item.channelId === channel.id && item.status === 'open');
  const actorName = actor.tag || actor.username || actor.id;
  await channel.delete(`Ticket ${actorName} tarafından kapatıldı`);
  if (ticket) closeTicket(ticket.id, actorName);
  await logModerationAction(channel.guild, actor, 'Ticket kapatma', `Kanal: #${channel.name}`);
}

const commands = [
  new SlashCommandBuilder().setName('yardim').setDescription('Tüm bot komutlarını menü halinde gösterir.'),
  new SlashCommandBuilder().setName('panel').setDescription('Web kontrol paneli bağlantısını gösterir.'),
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket açma panelini gösterir.'),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Bu kanala ticket açma paneli gönderir.'),
  new SlashCommandBuilder().setName('ticket-kapat').setDescription('İçinde bulunduğun ticketı kapatır.'),
  new SlashCommandBuilder().setName('ticket-ekle').setDescription('Ticketa kullanıcı ekler.').addUserOption((option) => option.setName('kullanici').setDescription('Eklenecek kullanıcı').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-cikar').setDescription('Tickettan kullanıcı çıkarır.').addUserOption((option) => option.setName('kullanici').setDescription('Çıkarılacak kullanıcı').setRequired(true)),
  new SlashCommandBuilder().setName('timeout').setDescription('Üyeyi belirli süreliğine susturur.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Susturulacak üye').setRequired(true))
    .addIntegerOption((option) => option.setName('dakika').setDescription('1-40320 dakika').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('kick').setDescription('Üyeyi sunucudan atar.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Atılacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('ban').setDescription('Üyeyi sunucudan yasaklar.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Yasaklanacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('timeout-kaldir').setDescription('Üyenin zaman aşımını kaldırır.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Timeout kaldırılacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('ban-kaldir').setDescription('Kullanıcının sunucu yasağını kaldırır.')
    .addStringOption((option) => option.setName('kullanici_id').setDescription('Yasaklı kullanıcının Discord ID bilgisi').setMinLength(17).setMaxLength(20).setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('ses-sustur').setDescription('Ses kanalındaki üyeyi sunucu genelinde susturur.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Susturulacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('ses-susturma-kaldir').setDescription('Üyenin sunucu ses susturmasını kaldırır.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Susturması kaldırılacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('sagirlestir').setDescription('Ses kanalındaki üyeyi sunucu genelinde sağırlaştırır.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Sağırlaştırılacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('sagirliligi-kaldir').setDescription('Üyenin sunucu sağırlaştırmasını kaldırır.')
    .addUserOption((option) => option.setName('kullanici').setDescription('Sağırlaştırması kaldırılacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('İşlem sebebi').setMaxLength(400)),
  new SlashCommandBuilder().setName('sil').setDescription('Kanaldaki son mesajları siler.').addIntegerOption((option) => option.setName('miktar').setDescription('1-100 arası mesaj').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('kanal-sil').setDescription('Seçtiğin kanal veya kategoriyi siler.').addChannelOption((option) => option.setName('hedef').setDescription('Silinecek kanal veya kategori').addChannelTypes(ChannelType.GuildText, ChannelType.GuildCategory).setRequired(true)),
  new SlashCommandBuilder().setName('kategori-olustur').setDescription('Yeni bir kanal kategorisi oluşturur.').addStringOption((option) => option.setName('isim').setDescription('Kategori adı').setRequired(true)),
  new SlashCommandBuilder().setName('kategori-sil').setDescription('Seçtiğin kategoriyi siler.').addChannelOption((option) => option.setName('kategori').setDescription('Silinecek kategori').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
  new SlashCommandBuilder().setName('rol-ekle').setDescription('Yeni rol oluşturur.').addStringOption((option) => option.setName('isim').setDescription('Rol adı').setRequired(true)),
  new SlashCommandBuilder().setName('rol-ver').setDescription('Kullanıcıya rol verir.').addUserOption((option) => option.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addRoleOption((option) => option.setName('rol').setDescription('Verilecek rol').setRequired(true)),
  new SlashCommandBuilder().setName('ayar').setDescription('Sunucu ayarlarını yapar.')
    .addSubcommand((sub) => sub.setName('kategori').setDescription('Ticket kategorisini ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Kategori').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand((sub) => sub.setName('destek-rolu').setDescription('Ticket moderatör rolünü ayarlar').addRoleOption((option) => option.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand((sub) => sub.setName('ticket-rolu').setDescription('Ticket açanlara verilecek rolü ayarlar').addRoleOption((option) => option.setName('rol').setDescription('Ticket rolü').setRequired(true)))
    .addSubcommand((sub) => sub.setName('hosgeldin').setDescription('Karşılama kanalını ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName('ayrilma').setDescription('Ayrılma kanalını ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName('ayrilma-mesaji').setDescription('Ayrılış afişinde kullanılacak mesajı ayarlar').addStringOption((option) => option.setName('mesaj').setDescription('{kullanici}, {takma_ad}, {sunucu}, {uye_sayisi} yer tutucuları kullanılabilir').setMaxLength(180).setRequired(true)))
    .addSubcommand((sub) => sub.setName('moderasyon-logu').setDescription('Moderasyon işlem kayıt kanalını ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Log kanalı').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName('otomatik-rol').setDescription('Yeni üyeye verilecek rolü ayarlar').addRoleOption((option) => option.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand((sub) => sub.setName('vanity-rol-ekle').setDescription('Bu role vanity URL değiştirme izni verir').addRoleOption((option) => option.setName('rol').setDescription('İzin verilecek rol').setRequired(true)))
    .addSubcommand((sub) => sub.setName('vanity-rol-cikar').setDescription('Bu rolün vanity URL değiştirme iznini kaldırır').addRoleOption((option) => option.setName('rol').setDescription('İzni kaldırılacak rol').setRequired(true))),
  new SlashCommandBuilder().setName('sunucu-bilgi').setDescription('Sunucu bilgilerini gösterir.')
].map((command) => command.toJSON());

let commandSyncPromise = null;
async function syncSlashCommands(guilds) {
  if (commandSyncPromise) return commandSyncPromise;
  commandSyncPromise = (async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });
      console.log('Eski global slash komutları temizlendi.');
    } catch (error) {
      console.error('Eski global slash komutları temizlenemedi:', error.message);
    }

    let allGuildsUpdated = true;
    for (const guild of guilds) {
      try {
        await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id), { body: [] });
        await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id), { body: commands });
        console.log(`Eski komutlar temizlendi ve ${commands.length} güncel komut kaydedildi: ${guild.name} (${guild.id})`);
      } catch (error) {
        allGuildsUpdated = false;
        console.error(`Slash komutları yenilenemedi (${guild.name}, ${guild.id}):`, error.message);
      }
    }
    return allGuildsUpdated;
  })().finally(() => { commandSyncPromise = null; });
  return commandSyncPromise;
}

client.once('clientReady', async () => {
  console.log(`${client.user.tag} olarak giriş yapıldı. ${client.guilds.cache.size} sunucu aktif.`);
  await syncSlashCommands([...client.guilds.cache.values()]);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
  if (oldGuild.vanityURLCode === newGuild.vanityURLCode) return;

  const eventTimestamp = Date.now();
  let entry;
  for (let attempt = 0; attempt < 5 && !entry; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
    const logs = await newGuild.fetchAuditLogs({ type: AuditLogEvent.GuildUpdate, limit: 10 }).catch(() => null);
    entry = logs?.entries.find((item) => item.target?.id === newGuild.id
      && item.createdTimestamp >= eventTimestamp - 5000
      && item.changes.some((change) => change.key === 'vanity_url_code'
        && change.new === newGuild.vanityURLCode
        && change.old === oldGuild.vanityURLCode));
  }

  if (!entry) {
    console.error(`Vanity URL değişikliğini yapan audit log kayıtlarında bulunamadı: ${newGuild.name}. Ban uygulanamadı.`);
    return;
  }

  if (entry.executorId === client.user.id) return;
  const allowedRoleIds = settingsFor(newGuild).vanityAllowedRoleIds;
  const member = await newGuild.members.fetch(entry.executorId).catch(() => null);
  const allowed = member && allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  if (allowed) return;

  try {
    await newGuild.members.ban(entry.executorId, { reason: 'İzinli vanity rollerinden biri olmadan sunucu vanity URL adresini değiştirdi.' });
    console.log(`Yetkisiz vanity URL değişikliği yapan banlandı: ${entry.executor?.tag || entry.executorId} (${newGuild.name})`);
    if (entry.executor) await logModerationAction(newGuild, entry.executor, 'Vanity URL nedeniyle ban', `Kullanıcı: ${entry.executor.tag}`);
  } catch (error) {
    console.error(`Vanity URL değişikliğini yapan banlanamadı (${entry.executorId}):`, error.message);
  }
});

client.on('guildMemberAdd', async (member) => {
  const settings = settingsFor(member.guild);
  if (settings.autoRoleId) {
    const botMember = member.guild.members.me;
    const role = await member.guild.roles.fetch(settings.autoRoleId).catch(() => null);
    if (!role) {
      console.error(`Otomatik rol bulunamadı: ${settings.autoRoleId} (${member.guild.name})`);
      updateSettings(member.guild.id, { autoRoleId: null });
    } else if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.error(`Otomatik rol verilemedi: botta Rolleri Yönet izni yok (${member.guild.name})`);
    } else if (role.managed || role.position >= botMember.roles.highest.position) {
      console.error(`Otomatik rol verilemedi: rol bot rolünün üstünde veya yönetiliyor (${role.name})`);
    } else {
      await member.roles.add(role)
        .then(() => console.log(`Otomatik rol verildi: ${role.name} -> ${member.user.tag}`))
        .catch((error) => console.error(`Otomatik rol hatası (${member.user.tag}):`, error.message));
    }
  }
  if (settings.welcomeChannelId) {
    const channel = await member.guild.channels.fetch(settings.welcomeChannelId).catch((error) => {
      console.error(`Hoş geldin kanalı alınamadı (${member.guild.name}):`, error.message);
      return null;
    });
    if (!channel?.isTextBased()) {
      console.error(`Hoş geldin kanalı geçersiz veya metin kanalı değil: ${settings.welcomeChannelId} (${member.guild.name})`);
    } else {
      try {
        const message = welcomeMessageFor(member, true);
        const image = await neonWelcomeImage(member, true, message);
        await channel.send({ files: [new AttachmentBuilder(image, { name: 'hos-geldin.png' })] });
      } catch (error) { console.error('Hoş geldin görseli gönderilemedi:', error.message); }
    }
  }
});
client.on('guildMemberRemove', async (member) => {
  const channelId = settingsFor(member.guild).goodbyeChannelId;
  if (!channelId) {
    console.warn(`Ayrılma afişi gönderilmedi; ayrılma kanalı ayarlanmamış (${member.guild.name}).`);
    return;
  }
  const channel = await member.guild.channels.fetch(channelId).catch((error) => {
    console.error(`Ayrılma kanalı alınamadı (${member.guild.name}, ${channelId}):`, error.message);
    return null;
  });
  if (!channel?.isTextBased()) {
    console.error(`Ayrılma kanalı geçersiz veya metin kanalı değil: ${channelId} (${member.guild.name})`);
    return;
  }
  const permissions = channel.permissionsFor(client.user);
  if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) {
    console.error(`Ayrılma afişi gönderilemedi; botta Kanalı Görüntüle, Mesaj Gönder ve Dosya Ekle izinleri eksik (${member.guild.name}, ${channel.name}).`);
    return;
  }
  try {
    const message = welcomeMessageFor(member, false);
    const image = await neonWelcomeImage(member, false, message);
    await channel.send({ files: [new AttachmentBuilder(image, { name: 'gule-gule.png' })] });
  } catch (error) {
    console.error(`Ayrılma afişi gönderilemedi (${member.guild.name}, ${member.user.tag}):`, error.message);
  }
});
client.on('channelDelete', (channel) => {
  if (!channel.guild) return;
  const ticket = listTickets(channel.guild.id).find((item) => item.channelId === channel.id && item.status === 'open');
  if (ticket) closeTicket(ticket.id, 'Ticket kanalı silindi');
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'help-menu') {
      const descriptions = { ticket: '🎫 `/ticket-panel`, `/ticket-kapat`, `/ticket-ekle`, `/ticket-cikar`', moderation: '🛡️ `/timeout`, `/timeout-kaldir`, `/kick`, `/ban`, `/ban-kaldir`, `/ses-sustur`, `/ses-susturma-kaldir`, `/sagirlestir`, `/sagirliligi-kaldir`, `/sil`', settings: '⚙️ `/ayar hosgeldin`, `/ayar ayrilma`, `/ayar ayrilma-mesaji`, `/ayar moderasyon-logu`', all: '📚 Tüm komutlar için `/yardim` menüsünü kullanabilirsin.' };
      return interaction.reply({ content: descriptions[interaction.values[0]], flags: MessageFlags.Ephemeral });
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'panel-ticket') return interaction.reply(brandedMessage({ embeds: [ticketEmbed()], components: ticketPanelComponents(), flags: MessageFlags.Ephemeral }));
      if (interaction.customId === 'panel-help') return interaction.reply(brandedMessage({ embeds: [helpEmbed()], components: helpComponents(), flags: MessageFlags.Ephemeral }));
      if (interaction.customId === 'ticket-open') {
        const existing = findOpenTicket(interaction.guild.id, interaction.user.id);
        if (existing) {
          const existingChannel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
          if (existingChannel) return interaction.reply({ content: `Zaten açık bir ticketın var: ${existingChannel}`, flags: MessageFlags.Ephemeral });
        }
        return interaction.showModal(ticketCreationModal());
      }
      if (interaction.customId === 'ticket-close') { if (!isModerator(interaction) && !interaction.channel.topic?.includes(`(${interaction.user.id})`)) return deny(interaction, 'Ticketı yalnızca açan kişi veya moderatör kapatabilir.'); await interaction.reply({ content: 'Ticket kapatılıyor.', flags: MessageFlags.Ephemeral }); return closeTicketChannel(interaction.channel, interaction.user); }
    }
    if (interaction.isModalSubmit() && interaction.customId === 'ticket-create') {
      const subject = interaction.fields.getTextInputValue('ticket-subject').trim();
      const details = interaction.fields.getTextInputValue('ticket-details').trim();
      const result = await createTicket(interaction.guild, interaction.user, subject, details);
      return interaction.reply({ content: result.existing ? `Zaten açık ticketın var: ${result.channel}` : `Ticket #${result.ticket.number} açıldı: ${result.channel}`, flags: MessageFlags.Ephemeral });
    }
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    if (commandName === 'yardim') {
      await interaction.reply(brandedMessage({ embeds: [helpEmbed()], components: helpComponents() }));
      if (interaction.guild) await syncSlashCommands([interaction.guild]);
      return;
    }
    if (commandName === 'panel') return interaction.reply(brandedMessage({ embeds: [new EmbedBuilder().setColor(0xffc000).setTitle('Orlin Sunucu Kontrol Paneli').setDescription('Ticket oluşturma paneline ve tüm komut listesine buradan erişebilirsin.')], components: mainPanelComponents() }));
    if (commandName === 'ticket') return interaction.reply(brandedMessage({ embeds: [ticketEmbed()], components: ticketPanelComponents() }));
    if (commandName === 'ticket-panel') { if (!isModerator(interaction)) return deny(interaction); return interaction.reply(brandedMessage({ embeds: [ticketEmbed()], components: ticketPanelComponents() })); }
    if (commandName === 'ticket-kapat') { if (!interaction.channel.topic?.startsWith('Ticket #')) return interaction.reply({ content: 'Bu kanal bir ticket kanalı değil.', flags: MessageFlags.Ephemeral }); if (!isModerator(interaction) && !interaction.channel.topic.includes(`(${interaction.user.id})`)) return deny(interaction); await interaction.reply('Ticket kapatılıyor...'); return closeTicketChannel(interaction.channel, interaction.user); }
    if (commandName === 'ticket-ekle' || commandName === 'ticket-cikar') { if (!isModerator(interaction) || !interaction.channel.topic?.startsWith('Ticket #')) return deny(interaction, 'Bu komut ticket moderatörleri içindir.'); const user = interaction.options.getUser('kullanici'); const allow = commandName === 'ticket-ekle'; await interaction.channel.permissionOverwrites.edit(user.id, allow ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false }); await logModerationAction(interaction.guild, interaction.user, allow ? 'Ticketa kullanıcı eklendi' : 'Tickettan kullanıcı çıkarıldı', `Kullanıcı: ${user.tag} (\`${user.id}\`), kanal: #${interaction.channel.name}`); return interaction.reply(`${user} ticketa ${allow ? 'eklendi' : 'çıkarıldı'}.`); }
    if (commandName === 'ban-kaldir') {
      if (!isModerator(interaction)) return deny(interaction);
      if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: 'Botta "Üyeleri Yasakla" izni yok.', flags: MessageFlags.Ephemeral });
      }
      const userId = interaction.options.getString('kullanici_id');
      if (!/^\d{17,20}$/.test(userId)) {
        return interaction.reply({ content: 'Geçerli bir Discord kullanıcı ID\'si gir. Kullanıcı ID\'sini kopyalamak için Discord Geliştirici Modu açık olmalıdır.', flags: MessageFlags.Ephemeral });
      }
      const ban = await interaction.guild.bans.fetch(userId).catch((error) => {
        if (error.code === 10026) return null;
        throw error;
      });
      if (!ban) return interaction.reply({ content: `\`${userId}\` bu sunucuda yasaklı değil.`, flags: MessageFlags.Ephemeral });
      const reason = interaction.options.getString('sebep');
      await interaction.guild.members.unban(userId, auditReason(interaction, reason));
      await logModerationAction(interaction.guild, interaction.user, 'Yasak kaldırma', `Kullanıcı: ${ban.user.tag} (\`${userId}\`), sebep: ${reason || 'Belirtilmedi.'}`);
      return interaction.reply({ content: `✅ ${ban.user.tag} kullanıcısının sunucu yasağı kaldırıldı.`, flags: MessageFlags.Ephemeral });
    }
    if (['timeout', 'timeout-kaldir', 'kick', 'ban', 'ses-sustur', 'ses-susturma-kaldir', 'sagirlestir', 'sagirliligi-kaldir'].includes(commandName)) {
      if (!isModerator(interaction)) return deny(interaction);
      const user = interaction.options.getUser('kullanici');
      const target = await interaction.guild.members.fetch(user.id);
      const hierarchyError = await checkModerationTarget(interaction, target);
      if (hierarchyError) return interaction.reply({ content: hierarchyError, flags: MessageFlags.Ephemeral });
      const isTimeout = commandName === 'timeout' || commandName === 'timeout-kaldir';
      const isMute = commandName === 'ses-sustur' || commandName === 'ses-susturma-kaldir';
      const isDeafen = commandName === 'sagirlestir' || commandName === 'sagirliligi-kaldir';
      const permission = isTimeout ? PermissionFlagsBits.ModerateMembers
        : isMute ? PermissionFlagsBits.MuteMembers
          : isDeafen ? PermissionFlagsBits.DeafenMembers
            : commandName === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.BanMembers;
      if (!interaction.guild.members.me?.permissions.has(permission)) {
        const permissionName = isTimeout ? 'Üyelere Zaman Aşımı Uygula'
          : isMute ? 'Üyeleri Sustur'
            : isDeafen ? 'Üyeleri Sağırlaştır'
              : commandName === 'kick' ? 'Üyeleri At' : 'Üyeleri Yasakla';
        return interaction.reply({ content: `Botta gerekli izin yok: ${permissionName}.`, flags: MessageFlags.Ephemeral });
      }
      const reason = interaction.options.getString('sebep');
      const audit = auditReason(interaction, reason);
      if (commandName === 'timeout') {
        const minutes = interaction.options.getInteger('dakika');
        await target.timeout(minutes * 60_000, audit);
        await logModerationAction(interaction.guild, interaction.user, 'Zaman aşımı', `Üye: ${target.user.tag} (\`${target.id}\`), süre: ${minutes} dakika, sebep: ${reason || 'Belirtilmedi.'}`);
        return interaction.reply({ content: `${target} ${minutes} dakika susturuldu.`, flags: MessageFlags.Ephemeral });
      }
      if (commandName === 'timeout-kaldir') {
        if (!target.communicationDisabledUntilTimestamp) return interaction.reply({ content: `${target.user.tag} üzerinde aktif bir timeout yok.`, flags: MessageFlags.Ephemeral });
        await target.timeout(null, audit);
        await logModerationAction(interaction.guild, interaction.user, 'Timeout kaldırma', `Üye: ${target.user.tag} (\`${target.id}\`), sebep: ${reason || 'Belirtilmedi.'}`);
        return interaction.reply({ content: `✅ ${target.user.tag} kullanıcısının timeout'u kaldırıldı.`, flags: MessageFlags.Ephemeral });
      }
      if (isMute || isDeafen) {
        if (!target.voice.channel) {
          return interaction.reply({ content: `${target.user.tag} şu anda bir ses kanalında değil. Ses susturmasını/sağırlaştırmasını değiştirmek için önce ses kanalına katılması gerekir.`, flags: MessageFlags.Ephemeral });
        }
        const enabled = commandName === 'ses-sustur' || commandName === 'sagirlestir';
        if (isMute && target.voice.serverMute === enabled) {
          return interaction.reply({ content: `Üyenin sunucu ses susturması zaten ${enabled ? 'açık' : 'kapalı'}.`, flags: MessageFlags.Ephemeral });
        }
        if (isDeafen && target.voice.serverDeaf === enabled) {
          return interaction.reply({ content: `Üyenin sunucu sağırlaştırması zaten ${enabled ? 'açık' : 'kapalı'}.`, flags: MessageFlags.Ephemeral });
        }
        if (isMute) await target.voice.setMute(enabled, audit);
        else await target.voice.setDeaf(enabled, audit);
        const action = isMute ? (enabled ? 'Ses susturma' : 'Ses susturmasını kaldırma')
          : (enabled ? 'Sağırlaştırma' : 'Sağırlaştırmayı kaldırma');
        await logModerationAction(interaction.guild, interaction.user, action, `Üye: ${target.user.tag} (\`${target.id}\`), kanal: ${target.voice.channel.name}, sebep: ${reason || 'Belirtilmedi.'}`);
        return interaction.reply({ content: `✅ ${target.user.tag} kullanıcısının ${isMute ? 'sunucu ses susturması' : 'sunucu sağırlaştırması'} ${enabled ? 'uygulandı' : 'kaldırıldı'}.`, flags: MessageFlags.Ephemeral });
      }
      if (commandName === 'kick') {
        await target.kick(audit);
        await logModerationAction(interaction.guild, interaction.user, 'Üye atma', `Üye: ${target.user.tag} (\`${target.id}\`), sebep: ${reason || 'Belirtilmedi.'}`);
        return interaction.reply({ content: `✅ ${target.user.tag} sunucudan atıldı.`, flags: MessageFlags.Ephemeral });
      }
      await target.ban({ reason: audit });
      await logModerationAction(interaction.guild, interaction.user, 'Üye yasaklama', `Üye: ${target.user.tag} (\`${target.id}\`), sebep: ${reason || 'Belirtilmedi.'}`);
      return interaction.reply({ content: `✅ ${target.user.tag} sunucudan yasaklandı.`, flags: MessageFlags.Ephemeral });
    }
    if (commandName === 'sil') { if (!isModerator(interaction)) return deny(interaction); const amount = interaction.options.getInteger('miktar'); const deleted = await interaction.channel.bulkDelete(amount, true); await logModerationAction(interaction.guild, interaction.user, 'Mesaj silme', `${deleted.size} mesaj #${interaction.channel.name} kanalından silindi (istenen: ${amount}).`); return interaction.reply({ content: `${deleted.size} mesaj silindi.`, flags: MessageFlags.Ephemeral }); }
    if (commandName === 'kanal-sil') { if (!isModerator(interaction)) return deny(interaction); const target = interaction.options.getChannel('hedef'); if (!target) return interaction.reply({ content: 'Silinecek kanal bulunamadı.', flags: MessageFlags.Ephemeral }); await interaction.reply({ content: `${target.name} siliniyor.`, flags: MessageFlags.Ephemeral }); await target.delete(`Silme: ${interaction.user.tag}`); return logModerationAction(interaction.guild, interaction.user, 'Kanal silme', `Kanal: #${target.name} (\`${target.id}\`).`); }
    if (commandName === 'kategori-olustur') { if (!isModerator(interaction)) return deny(interaction); const name = interaction.options.getString('isim')?.trim(); if (!name) return interaction.reply({ content: 'Kategori adı boş olamaz.', flags: MessageFlags.Ephemeral }); const category = await interaction.guild.channels.create({ name, type: ChannelType.GuildCategory, reason: `Oluşturan: ${interaction.user.tag}` }); await logModerationAction(interaction.guild, interaction.user, 'Kategori oluşturma', `Kategori: ${category.name} (\`${category.id}\`).`); return interaction.reply(`✅ ${category.name} kategorisi oluşturuldu.`); }
    if (commandName === 'kategori-sil') { if (!isModerator(interaction)) return deny(interaction); const category = interaction.options.getChannel('kategori'); if (!category) return interaction.reply({ content: 'Silinecek kategori bulunamadı.', flags: MessageFlags.Ephemeral }); await interaction.reply({ content: `${category.name} kategorisi siliniyor. İçindeki kanallar korunur.`, flags: MessageFlags.Ephemeral }); await category.delete(`Kategori silme: ${interaction.user.tag}`); return logModerationAction(interaction.guild, interaction.user, 'Kategori silme', `Kategori: ${category.name} (\`${category.id}\`).`); }
    if (commandName === 'rol-ekle') { if (!isModerator(interaction)) return deny(interaction); const role = await interaction.guild.roles.create({ name: interaction.options.getString('isim'), reason: `Oluşturan: ${interaction.user.tag}` }); await logModerationAction(interaction.guild, interaction.user, 'Rol oluşturma', `Rol: ${role.name} (\`${role.id}\`).`); return interaction.reply(`✅ ${role} rolü oluşturuldu.`); }
    if (commandName === 'rol-ver') { if (!isModerator(interaction)) return deny(interaction); const member = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id); const role = interaction.options.getRole('rol'); await member.roles.add(role); await logModerationAction(interaction.guild, interaction.user, 'Rol verme', `Kullanıcı: ${member.user.tag} (\`${member.id}\`), rol: ${role.name} (\`${role.id}\`).`); return interaction.reply(`✅ ${member} kullanıcısına ${role} verildi.`); }
    if (commandName === 'ayar') {
      if (!isOwner(interaction)) return deny(interaction, 'Sunucu ayarlarını yalnızca sunucu sahibi değiştirebilir.');
      const sub = interaction.options.getSubcommand();
      const values = {};
      if (sub === 'kategori') {
        const channel = interaction.options.getChannel('kanal');
        if (!channel) return interaction.reply({ content: 'Kategori kanalı bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.categoryId = channel.id;
        values.categoryName = channel.name;
      } else if (sub === 'destek-rolu') {
        const role = interaction.options.getRole('rol');
        if (!role) return interaction.reply({ content: 'Destek rolü bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.moderatorRoleId = role.id;
      } else if (sub === 'ticket-rolu') {
        const role = interaction.options.getRole('rol');
        if (!role) return interaction.reply({ content: 'Ticket rolü bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.ticketRoleId = role.id;
      } else if (sub === 'ayrilma-mesaji') {
        const message = interaction.options.getString('mesaj')?.trim();
        if (!message) return interaction.reply({ content: 'Afiş mesajı boş olamaz.', flags: MessageFlags.Ephemeral });
        values.goodbyeMessage = message;
      } else if (sub === 'hosgeldin') {
        const channel = interaction.options.getChannel('kanal');
        if (!channel) return interaction.reply({ content: 'Karşılama kanalı bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.welcomeChannelId = channel.id;
      } else if (sub === 'ayrilma') {
        const channel = interaction.options.getChannel('kanal');
        if (!channel) return interaction.reply({ content: 'Ayrılma kanalı bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.goodbyeChannelId = channel.id;
      } else if (sub === 'moderasyon-logu') {
        const channel = interaction.options.getChannel('kanal');
        if (!channel) return interaction.reply({ content: 'Moderasyon log kanalı bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.moderationLogChannelId = channel.id;
      } else if (sub === 'otomatik-rol') {
        const role = interaction.options.getRole('rol');
        if (!role) return interaction.reply({ content: 'Otomatik rol bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.autoRoleId = role.id;
      } else if (sub === 'vanity-rol-ekle' || sub === 'vanity-rol-cikar') {
        const role = interaction.options.getRole('rol');
        if (!role) return interaction.reply({ content: 'Rol bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        const allowedRoleIds = new Set(settingsFor(interaction.guild).vanityAllowedRoleIds);
        if (sub === 'vanity-rol-ekle') allowedRoleIds.add(role.id);
        else allowedRoleIds.delete(role.id);
        values.vanityAllowedRoleIds = [...allowedRoleIds];
      } else {
        return interaction.reply({ content: 'Bilinmeyen sunucu ayarı.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'otomatik-rol' || sub === 'ticket-rolu') {
        const role = interaction.options.getRole('rol');
        const botMember = interaction.guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'Botta "Rolleri Yönet" izni yok. Sunucu ayarlarından bu izni ver.', flags: MessageFlags.Ephemeral });
        if (role.managed) return interaction.reply({ content: 'Entegrasyon tarafından yönetilen bir rol otomatik rol olarak kullanılamaz.', flags: MessageFlags.Ephemeral });
        if (role.position >= botMember.roles.highest.position) return interaction.reply({ content: 'Seçilen rol botun rolünün üstünde veya aynı seviyede. Bot rolünü Discord rol listesinde seçilen rolün üstüne taşı.', flags: MessageFlags.Ephemeral });
      }
      updateSettings(interaction.guild.id, values);
      await logModerationAction(interaction.guild, interaction.user, 'Sunucu ayarını güncelleme', `Ayar: ${sub}`);
      return interaction.reply(`✅ ${sub} ayarı kaydedildi.`);
    }
    if (commandName === 'sunucu-bilgi') return interaction.reply(brandedMessage({ embeds: [new EmbedBuilder().setColor(0xffc000).setTitle(interaction.guild.name).addFields({ name: 'Üye', value: String(interaction.guild.memberCount), inline: true }, { name: 'Kanal', value: String(interaction.guild.channels.cache.size), inline: true }, { name: 'Rol', value: String(interaction.guild.roles.cache.size), inline: true })] }));
  } catch (error) {
    console.error('Etkileşim hatası:', error);
    const message = error?.code === 50013 ? 'Botun bu işlem için gerekli Discord izni yok. Bot rolü ve kanal izinlerini kontrol et.' : 'İşlem sırasında bir hata oluştu. Ayrıntı için VDS ekranındaki PM2 kayıtlarına bak.';
    if (!interaction.replied && !interaction.deferred) interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (['help', '!help', 'yardim', '!yardim'].includes(message.content.toLowerCase().trim())) {
    await message.reply(brandedMessage({ embeds: [helpEmbed()], components: helpComponents() }));
    if (message.guild) await syncSlashCommands([message.guild]);
    return;
  }
  if (message.content.toLowerCase().trim() === '!ping') return message.reply('Pong!');
});

app.listen(port, () => console.log(`Web panel hazır: http://localhost:${port}`));
console.log('Giriş/çıkış afişleri sürümü: 3 (tek görsel gönderimi)');
if (process.env.DISCORD_TOKEN) client.login(process.env.DISCORD_TOKEN).catch((error) => console.error('Discord bağlantı hatası:', error.message));
