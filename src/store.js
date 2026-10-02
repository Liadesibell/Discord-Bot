const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'store.json');

function readStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) return { tickets: [], settings: {}, counters: {} };
  try {
    const store = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { tickets: [], settings: {}, counters: {}, ...store };
  } catch { return { tickets: [], settings: {}, counters: {} }; }
}

function writeStore(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

function listTickets(guildId) {
  return readStore().tickets
    .filter((ticket) => !guildId || ticket.guildId === guildId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function saveTicket(ticket) { const store = readStore(); store.tickets.push(ticket); writeStore(store); return ticket; }
function findOpenTicket(guildId, userId) { return readStore().tickets.find((ticket) => ticket.guildId === guildId && ticket.userId === userId && ticket.status === 'open'); }
function nextTicketNumber(guildId) {
  const store = readStore();
  store.counters[guildId] = (store.counters[guildId] || 0) + 1;
  writeStore(store);
  return store.counters[guildId];
}
function closeTicket(id, closedBy) {
  const store = readStore();
  const ticket = store.tickets.find((item) => item.id === id);
  if (!ticket) return null;
  ticket.status = 'closed'; ticket.closedAt = new Date().toISOString(); ticket.closedBy = closedBy;
  writeStore(store); return ticket;
}

function getSettings(guildId) {
  const store = readStore();
  return store.settings[guildId] || {};
}
function updateSettings(guildId, changes) {
  const store = readStore();
  store.settings[guildId] = { ...(store.settings[guildId] || {}), ...changes };
  writeStore(store);
  return store.settings[guildId];
}

module.exports = { listTickets, saveTicket, findOpenTicket, nextTicketNumber, closeTicket, getSettings, updateSettings };