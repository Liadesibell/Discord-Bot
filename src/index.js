require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, REST, Routes,
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  MessageFlags, AttachmentBuilder
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
    GatewayIntentBits.MessageContent
  ]
});
const app = express();
const port = Number(process.env.PORT || 3000);
const defaultCategoryName = process.env.TICKET_CATEGORY_NAME || 'Tickets';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('tiny'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'development-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 } }));

function requireAuth(req, res, next) { if (!req.session.user) return res.redirect('/'); next(); }
function dashboardData(req) { const guilds = client.guilds.cache.filter((guild) => guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)); return { user: req.session.user, guilds: [...guilds.values()], tickets: listTickets(), query: req.query }; }
function isOwner(interaction) { return interaction.guild?.ownerId === interaction.user.id; }
function isModerator(interaction) {
  const configuredRole = interaction.guild && settingsFor(interaction.guild).moderatorRoleId;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || configuredRole && interaction.member?.roles?.cache?.has(configuredRole) || isOwner(interaction);
}
function deny(interaction, text) { return interaction.reply({ content: `Bu işlem için yetkin yok. ${text || ''}`, flags: MessageFlags.Ephemeral }); }
function settingsFor(guild) { return { categoryId: null, categoryName: defaultCategoryName, moderatorRoleId: process.env.TICKET_SUPPORT_ROLE_ID || null, ticketRoleId: null, welcomeChannelId: null, goodbyeChannelId: null, autoRoleId: null, vanityAllowedRoleIds: [], ...getSettings(guild.id) }; }
function helpEmbed() {
  return new EmbedBuilder().setColor(0x5865f2).setTitle('Kontrol Merkezi').setDescription('Aşağıdaki menüden komut grubunu seç veya doğrudan slash komutlarını kullan.').addFields(
    { name: 'Ticket', value: '`/ticket` veya `/ticket-panel` panel gönderir\n`/ticket-kapat` açık ticketı kapatır\n`/ticket-ekle` kullanıcı ekler\n`/ticket-cikar` kullanıcı çıkarır' },
    { name: 'Moderasyon', value: '`/sil` mesajları siler\n`/kanal-sil` seçilen kanalı siler\n`/kategori-olustur` kategori oluşturur\n`/kategori-sil` kategori siler\n`/rol-ekle` rol oluşturur\n`/rol-ver` üyeye rol verir' },
    { name: 'Sunucu ayarları', value: '`/ayar kategori` ticket kategorisi\n`/ayar destek-rolu` moderatör rolü\n`/ayar ticket-rolu` ticket açan rolü\n`/ayar hosgeldin` karşılama kanalı\n`/ayar ayrilma` ayrılma kanalı\n`/ayar otomatik-rol` yeni üyeye rol\n`/ayar vanity-rol-ekle` URL değiştirme izni\n`/ayar vanity-rol-cikar` URL iznini kaldırır' },
    { name: 'Bilgi', value: '`/sunucu-bilgi` sunucu bilgisi\n`/panel` web paneli\n`/yardim` bu menü' }
  ).setFooter({ text: 'Yetki ayarlarını yalnızca sunucu sahibi yapabilir.' });
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
function mainPanelComponents() { return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('panel-ticket').setLabel('Ticket paneli').setStyle(ButtonStyle.Primary).setEmoji('🎫'), new ButtonBuilder().setCustomId('panel-help').setLabel('Komutlar').setStyle(ButtonStyle.Secondary).setEmoji('📚'))]; }
function ticketEmbed() { return new EmbedBuilder().setColor(0x57f287).setTitle('Destek Merkezi').setDescription('Destek almak için aşağıdaki **Ticket aç** düğmesine bas. Sana özel bir kanal oluşturulur.'); }
function neonWelcomeCard(member, joined) {
  const accent = joined ? '#d8ff4f' : '#ff6bd6';
  const safeName = String(member.user.username).replace(/[<&>"']/g, '').slice(0, 24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500" viewBox="0 0 1200 500"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8fff0"/><stop offset=".48" stop-color="#dffff0"/><stop offset="1" stop-color="#b8ffd0"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="1200" height="500" rx="36" fill="url(#bg)"/><circle cx="1020" cy="90" r="150" fill="#efff6b" opacity=".5"/><circle cx="1080" cy="430" r="210" fill="#9effd2" opacity=".55"/><path d="M0 410 C260 300 380 520 650 390 S980 270 1200 350" fill="none" stroke="${accent}" stroke-width="12" opacity=".8" filter="url(#glow)"/><rect x="58" y="58" width="1084" height="384" rx="28" fill="#ffffff" opacity=".68" stroke="#ffffff" stroke-width="3"/><text x="100" y="270" font-family="Arial,sans-serif" font-size="64" font-weight="800" fill="#132b26">@${safeName}</text><circle cx="1000" cy="235" r="92" fill="#ffffff" stroke="${accent}" stroke-width="10" filter="url(#glow)"/></svg>`;
}
async function neonWelcomeImage(member, joined) {
  const card = await sharp(Buffer.from(neonWelcomeCard(member, joined))).png().toBuffer();
  const logoPaths = [
    path.join(__dirname, '..', 'public', 'core-ink-logo.png'),
    path.join(__dirname, '..', 'public', 'ChatGPT_Image_10_Eyl_2026_14_42_46-removebg-preview.png')
  ];
  const logoPath = logoPaths.find((filePath) => fs.existsSync(filePath));
  if (!logoPath) return card;
  const logo = await sharp(logoPath).resize(132, 132, { fit: 'contain' }).png().toBuffer();
  return sharp(card).composite([{ input: logo, left: 934, top: 169 }]).png().toBuffer();
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
app.post('/guilds/:guildId/channels', requireAuth, async (req, res) => {
  try { const guild = client.guilds.cache.get(req.params.guildId); if (!guild || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return res.status(403).send('Botun kanal yönetme yetkisi yok.'); const channel = await guild.channels.create({ name: req.body.name?.trim() || 'yeni-kanal', type: ChannelType.GuildText, topic: req.body.topic?.trim() || undefined }); res.redirect(`/dashboard?ok=${encodeURIComponent(`${channel.name} kanalı oluşturuldu`)}`); }
  catch (error) { console.error(error); res.status(500).send('Kanal oluşturulamadı.'); }
});
app.post('/guilds/:guildId/invites', requireAuth, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.guildId);
    const botMember = guild?.members.me;
    if (!guild || !botMember?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) return res.status(403).send('Botun davet oluşturma yetkisi yok.');
    const channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.permissionsFor(botMember)?.has(PermissionFlagsBits.CreateInstantInvite));
    if (!channel) return res.status(403).send('Davet oluşturulacak uygun kanal bulunamadı.');
    const invite = await channel.createInvite({ maxAge: 86400, maxUses: 0, unique: true, reason: `Panel kullanıcısı: ${req.session.user.username}` });
    const recipient = await client.users.fetch(req.session.user.id);
    await recipient.send(`Sunucu davet bağlantın (24 saat geçerli): ${invite.url}`);
    res.redirect(`/dashboard?ok=${encodeURIComponent('Davet bağlantısı DM olarak gönderildi')}`);
  } catch (error) { console.error(error); res.status(500).send('Davet oluşturulamadı veya DM gönderilemedi.'); }
});
app.post('/tickets/:id/close', requireAuth, async (req, res) => { const ticket = closeTicket(req.params.id, req.session.user.username); if (ticket) { const channel = await client.channels.fetch(ticket.channelId).catch(() => null); if (channel) await channel.delete('Panelden kapatıldı').catch(() => null); } res.redirect('/dashboard'); });

async function ensureTicketCategory(guild) {
  const settings = settingsFor(guild);
  let category = settings.categoryId ? guild.channels.cache.get(settings.categoryId) : null;
  if (!category) category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === settings.categoryName);
  if (!category) category = await guild.channels.create({ name: settings.categoryName, type: ChannelType.GuildCategory });
  if (settings.categoryId !== category.id) updateSettings(guild.id, { categoryId: category.id });
  return category;
}
async function createTicket(guild, user) {
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
  const channel = await guild.channels.create({ name: `ticket-${String(number).padStart(4, '0')}`, type: ChannelType.GuildText, parent: category.id, topic: `Ticket #${number} | ${user.tag} (${user.id})`, permissionOverwrites: [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ...(moderatorRole ? [{ id: moderatorRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
  ] });
  if (ticketRole) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.add(ticketRole).catch((error) => console.error('Ticket rolü verilemedi:', error.message));
  }
  const ticket = saveTicket({ id: `${guild.id}-${number}`, number, guildId: guild.id, channelId: channel.id, userId: user.id, userTag: user.tag, status: 'open', createdAt: new Date().toISOString() });
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`Ticket #${number}`).setDescription('Sorununu bu kanala yaz. Destek ekibi en kısa sürede yanıt verecek.').addFields({ name: 'Açan', value: `<@${user.id}>` }).setTimestamp();
  await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket-close').setLabel('Ticket kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒'))] });
  return { ticket, channel };
}
async function closeTicketChannel(channel, closedBy) { const ticket = listTickets().find((item) => item.channelId === channel.id && item.status === 'open'); if (ticket) closeTicket(ticket.id, closedBy); await channel.delete(`Ticket ${closedBy} tarafından kapatıldı`).catch(() => null); }

const commands = [
  new SlashCommandBuilder().setName('yardim').setDescription('Tüm bot komutlarını menü halinde gösterir.'),
  new SlashCommandBuilder().setName('panel').setDescription('Web kontrol paneli bağlantısını gösterir.'),
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket açma panelini gösterir.'),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Bu kanala ticket açma paneli gönderir.'),
  new SlashCommandBuilder().setName('ticket-kapat').setDescription('İçinde bulunduğun ticketı kapatır.'),
  new SlashCommandBuilder().setName('ticket-ekle').setDescription('Ticketa kullanıcı ekler.').addUserOption((option) => option.setName('kullanici').setDescription('Eklenecek kullanıcı').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-cikar').setDescription('Tickettan kullanıcı çıkarır.').addUserOption((option) => option.setName('kullanici').setDescription('Çıkarılacak kullanıcı').setRequired(true)),
  new SlashCommandBuilder().setName('sil').setDescription('Kanaldaki son mesajları siler.').addIntegerOption((option) => option.setName('miktar').setDescription('1-100 arası mesaj').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('kanal-sil').setDescription('Seçtiğin kanal veya kategoriyi siler.').addChannelOption((option) => option.setName('hedef').setDescription('Silinecek kanal veya kategori').addChannelTypes(ChannelType.GuildText, ChannelType.GuildCategory).setRequired(true)),
  new SlashCommandBuilder().setName('kategori-olustur').setDescription('Yeni bir kanal kategorisi oluşturur.').addStringOption((option) => option.setName('isim').setDescription('Kategori adı').setRequired(true)),
  new SlashCommandBuilder().setName('kategori-sil').setDescription('Seçtiğin kategoriyi siler.').addChannelOption((option) => option.setName('kategori').setDescription('Silinecek kategori').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
  new SlashCommandBuilder().setName('rol-ekle').setDescription('Yeni rol oluşturur.').addStringOption((option) => option.setName('isim').setDescription('Rol adı').setRequired(true)),
  new SlashCommandBuilder().setName('rol-ver').setDescription('Kullanıcıya rol verir.').addUserOption((option) => option.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addRoleOption((option) => option.setName('rol').setDescription('Verilecek rol').setRequired(true)),
  new SlashCommandBuilder().setName('ayar').setDescription('Sunucu ayarlarını yapar.').addSubcommand((sub) => sub.setName('kategori').setDescription('Ticket kategorisini ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Kategori').addChannelTypes(ChannelType.GuildCategory).setRequired(true))).addSubcommand((sub) => sub.setName('destek-rolu').setDescription('Ticket moderatör rolünü ayarlar').addRoleOption((option) => option.setName('rol').setDescription('Rol').setRequired(true))).addSubcommand((sub) => sub.setName('ticket-rolu').setDescription('Ticket açanlara verilecek rolü ayarlar').addRoleOption((option) => option.setName('rol').setDescription('Ticket rolü').setRequired(true))).addSubcommand((sub) => sub.setName('hosgeldin').setDescription('Karşılama kanalını ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand((sub) => sub.setName('ayrilma').setDescription('Ayrılma kanalını ayarlar').addChannelOption((option) => option.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand((sub) => sub.setName('otomatik-rol').setDescription('Yeni üyeye verilecek rolü ayarlar').addRoleOption((option) => option.setName('rol').setDescription('Rol').setRequired(true))).addSubcommand((sub) => sub.setName('vanity-rol-ekle').setDescription('Bu role vanity URL değiştirme izni verir').addRoleOption((option) => option.setName('rol').setDescription('İzin verilecek rol').setRequired(true))).addSubcommand((sub) => sub.setName('vanity-rol-cikar').setDescription('Bu rolün vanity URL değiştirme iznini kaldırır').addRoleOption((option) => option.setName('rol').setDescription('İzni kaldırılacak rol').setRequired(true))),
  new SlashCommandBuilder().setName('sunucu-bilgi').setDescription('Sunucu bilgilerini gösterir.')
].map((command) => command.toJSON());

client.once('clientReady', async () => {
  console.log(`${client.user.tag} olarak giriş yapıldı. ${client.guilds.cache.size} sunucu aktif.`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log('Slash komutları güncellendi.');
  } catch (error) { console.error('Slash komutları güncellenemedi:', error.message); }
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

  await newGuild.members.ban(entry.executorId, { reason: 'İzinli vanity rollerinden biri olmadan sunucu vanity URL adresini değiştirdi.' })
    .then(() => console.log(`Yetkisiz vanity URL değişikliği yapan banlandı: ${entry.executor?.tag || entry.executorId} (${newGuild.name})`))
    .catch((error) => console.error(`Vanity URL değişikliğini yapan banlanamadı (${entry.executorId}):`, error.message));
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
    const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
    if (channel) {
      try {
        const image = await neonWelcomeImage(member, true);
        await channel.send({ files: [new AttachmentBuilder(image, { name: 'hos-geldin.png' })] });
      } catch (error) { console.error('Hoş geldin görseli gönderilemedi:', error.message); }
    }
  }
});
client.on('guildMemberRemove', async (member) => {
  const channelId = settingsFor(member.guild).goodbyeChannelId;
  const channel = channelId && member.guild.channels.cache.get(channelId);
  if (channel) {
    try {
      const image = await neonWelcomeImage(member, false);
      await channel.send({ files: [new AttachmentBuilder(image, { name: 'gule-gule.png' })] });
    } catch (error) { console.error('Ayrılma görseli gönderilemedi:', error.message); }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'help-menu') {
      const descriptions = { ticket: '🎫 `/ticket-panel`, `/ticket-kapat`, `/ticket-ekle`, `/ticket-cikar`', moderation: '🛡️ `/sil`, `/kanal-sil`, `/rol-ekle`, `/rol-ver`', settings: '⚙️ `/ayar kategori`, `/ayar destek-rolu`, `/ayar hosgeldin`, `/ayar ayrilma`, `/ayar otomatik-rol`', all: '📚 Tüm komutlar için `/yardim` menüsünü kullanabilirsin.' };
      return interaction.reply({ content: descriptions[interaction.values[0]], flags: MessageFlags.Ephemeral });
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'panel-ticket') return interaction.reply({ embeds: [ticketEmbed()], components: ticketPanelComponents(), flags: MessageFlags.Ephemeral });
      if (interaction.customId === 'panel-help') return interaction.reply({ embeds: [helpEmbed()], components: helpComponents(), flags: MessageFlags.Ephemeral });
      if (interaction.customId === 'ticket-open') { const result = await createTicket(interaction.guild, interaction.user); return interaction.reply({ content: result.existing ? `Zaten açık ticketın var: ${result.channel}` : `Ticketın açıldı: ${result.channel}`, flags: MessageFlags.Ephemeral }); }
      if (interaction.customId === 'ticket-close') { if (!isModerator(interaction) && !interaction.channel.topic?.includes(`(${interaction.user.id})`)) return deny(interaction, 'Ticketı yalnızca açan kişi veya moderatör kapatabilir.'); await interaction.reply({ content: 'Ticket kapatılıyor.', flags: MessageFlags.Ephemeral }); return closeTicketChannel(interaction.channel, interaction.user.tag); }
    }
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    if (commandName === 'yardim') return interaction.reply({ embeds: [helpEmbed()], components: helpComponents() });
    if (commandName === 'panel') return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Sunucu Kontrol Paneli').setDescription('Ticket oluşturma paneline ve tüm komut listesine buradan erişebilirsin.')], components: mainPanelComponents() });
    if (commandName === 'ticket') return interaction.reply({ embeds: [ticketEmbed()], components: ticketPanelComponents() });
    if (commandName === 'ticket-panel') { if (!isModerator(interaction)) return deny(interaction); return interaction.reply({ embeds: [ticketEmbed()], components: ticketPanelComponents() }); }
    if (commandName === 'ticket-kapat') { if (!interaction.channel.topic?.startsWith('Ticket #')) return interaction.reply({ content: 'Bu kanal bir ticket kanalı değil.', flags: MessageFlags.Ephemeral }); if (!isModerator(interaction) && !interaction.channel.topic.includes(`(${interaction.user.id})`)) return deny(interaction); await interaction.reply('Ticket kapatılıyor...'); return closeTicketChannel(interaction.channel, interaction.user.tag); }
    if (commandName === 'ticket-ekle' || commandName === 'ticket-cikar') { if (!isModerator(interaction) || !interaction.channel.topic?.startsWith('Ticket #')) return deny(interaction, 'Bu komut ticket moderatörleri içindir.'); const user = interaction.options.getUser('kullanici'); const allow = commandName === 'ticket-ekle'; await interaction.channel.permissionOverwrites.edit(user.id, allow ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true } : { ViewChannel: false }); return interaction.reply(`${user} ticketa ${allow ? 'eklendi' : 'çıkarıldı'}.`); }
    if (commandName === 'sil') { if (!isModerator(interaction)) return deny(interaction); const amount = interaction.options.getInteger('miktar'); await interaction.channel.bulkDelete(amount, true); return interaction.reply({ content: `${amount} mesaj silindi.`, flags: MessageFlags.Ephemeral }); }
    if (commandName === 'kanal-sil') { if (!isModerator(interaction)) return deny(interaction); const target = interaction.options.getChannel('hedef'); if (!target) return interaction.reply({ content: 'Silinecek kanal bulunamadı.', flags: MessageFlags.Ephemeral }); await interaction.reply({ content: `${target.name} siliniyor.`, flags: MessageFlags.Ephemeral }); return target.delete(`Silme: ${interaction.user.tag}`); }
    if (commandName === 'kategori-olustur') { if (!isModerator(interaction)) return deny(interaction); const name = interaction.options.getString('isim')?.trim(); if (!name) return interaction.reply({ content: 'Kategori adı boş olamaz.', flags: MessageFlags.Ephemeral }); const category = await interaction.guild.channels.create({ name, type: ChannelType.GuildCategory, reason: `Oluşturan: ${interaction.user.tag}` }); return interaction.reply(`✅ ${category.name} kategorisi oluşturuldu.`); }
    if (commandName === 'kategori-sil') { if (!isModerator(interaction)) return deny(interaction); const category = interaction.options.getChannel('kategori'); if (!category) return interaction.reply({ content: 'Silinecek kategori bulunamadı.', flags: MessageFlags.Ephemeral }); await interaction.reply({ content: `${category.name} kategorisi siliniyor. İçindeki kanallar korunur.`, flags: MessageFlags.Ephemeral }); return category.delete(`Kategori silme: ${interaction.user.tag}`); }
    if (commandName === 'rol-ekle') { if (!isModerator(interaction)) return deny(interaction); const role = await interaction.guild.roles.create({ name: interaction.options.getString('isim'), reason: `Oluşturan: ${interaction.user.tag}` }); return interaction.reply(`✅ ${role} rolü oluşturuldu.`); }
    if (commandName === 'rol-ver') { if (!isModerator(interaction)) return deny(interaction); const member = await interaction.guild.members.fetch(interaction.options.getUser('kullanici').id); const role = interaction.options.getRole('rol'); await member.roles.add(role); return interaction.reply(`✅ ${member} kullanıcısına ${role} verildi.`); }
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
      } else if (sub === 'hosgeldin') {
        const channel = interaction.options.getChannel('kanal');
        if (!channel) return interaction.reply({ content: 'Karşılama kanalı bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.welcomeChannelId = channel.id;
      } else if (sub === 'ayrilma') {
        const channel = interaction.options.getChannel('kanal');
        if (!channel) return interaction.reply({ content: 'Ayrılma kanalı bulunamadı. Komutu tekrar çalıştır.', flags: MessageFlags.Ephemeral });
        values.goodbyeChannelId = channel.id;
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
      updateSettings(interaction.guild.id, values); return interaction.reply(`✅ ${sub} ayarı kaydedildi.`);
    }
    if (commandName === 'sunucu-bilgi') return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(interaction.guild.name).addFields({ name: 'Üye', value: String(interaction.guild.memberCount), inline: true }, { name: 'Kanal', value: String(interaction.guild.channels.cache.size), inline: true }, { name: 'Rol', value: String(interaction.guild.roles.cache.size), inline: true })] });
  } catch (error) {
    console.error('Etkileşim hatası:', error);
    const message = error?.code === 50013 ? 'Botun bu işlem için gerekli Discord izni yok. Bot rolü ve kanal izinlerini kontrol et.' : 'İşlem sırasında bir hata oluştu. Ayrıntı için VDS ekranındaki PM2 kayıtlarına bak.';
    if (!interaction.replied && !interaction.deferred) interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (['help', '!help', 'yardim', '!yardim'].includes(message.content.toLowerCase().trim())) return message.reply({ embeds: [helpEmbed()], components: helpComponents() });
  if (message.content.toLowerCase().trim() === '!ping') return message.reply('Pong!');
});

app.listen(port, () => console.log(`Web panel hazır: http://localhost:${port}`));
console.log('Gelen-giden görsel sürümü: 2 (sadece @kullanici + logo)');
if (process.env.DISCORD_TOKEN) client.login(process.env.DISCORD_TOKEN).catch((error) => console.error('Discord bağlantı hatası:', error.message));
