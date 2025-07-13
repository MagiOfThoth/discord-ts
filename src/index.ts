// === rping-bot using Discord.js + TypeScript-compatible JS ===

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const TARGET_EMOJI = '🛎';
const RESOLVE_EMOJI = '✅';
const SETTINGS_FILE = 'settings.json';
let flaggedMessages = {};

// Load/save settings from a file
function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE));
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await client.guilds.fetch(); // Ensure cache is ready
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    return interaction.reply({ content: '❌ This command can only be used in servers.', ephemeral: true });
  }

  const gid = interaction.guild.id;
  const commandName = interaction.commandName;

  if (commandName === 'setalertchannel') {
    const channel = interaction.options.getChannel('channel');
    settings[gid] = settings[gid] || {};
    settings[gid].admin_channel_id = channel.id;
    saveSettings(settings);
    await interaction.reply({ content: `✅ Alert channel set to ${channel}`, ephemeral: true });

  } else if (commandName === 'setalertrole') {
    const role = interaction.options.getRole('role');
    settings[gid] = settings[gid] || {};
    settings[gid].role_id_to_ping = role.id;
    saveSettings(settings);
    await interaction.reply({ content: `✅ Alert role set to ${role}`, ephemeral: true });

  } else if (commandName === 'viewalertsettings') {
    const guildSettings = settings[gid];
    if (!guildSettings) return await interaction.reply({ content: `⚠️ No settings found.`, ephemeral: true });

    const role = interaction.guild.roles.cache.get(guildSettings.role_id_to_ping);
    const channel = interaction.guild.channels.cache.get(guildSettings.admin_channel_id);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Alert Settings')
      .addFields(
        { name: 'Admin Channel', value: channel ? `<#${channel.id}>` : '`[Deleted]`' },
        { name: 'Ping Role', value: role ? `<@&${role.id}>` : '`[Deleted]`' }
      )
      .setColor(0x00FF00);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  const { message } = reaction;
  const guild = message.guild;
  const gid = guild?.id;
  if (!gid || !settings[gid]) return;

  const roleId = settings[gid].role_id_to_ping;
  const adminChannelId = settings[gid].admin_channel_id;
  const adminChannel = guild.channels.cache.get(adminChannelId);
  const member = await guild.members.fetch(user.id);

  if (reaction.emoji.name === TARGET_EMOJI) {
    if (flaggedMessages[message.id]) return; // already flagged

    const msgPreview = message.content ? message.content.slice(0, 1024) : '[No content]';
    const msgLink = `https://discord.com/channels/${guild.id}/${message.channel.id}/${message.id}`;

    const embed = new EmbedBuilder()
      .setTitle('🔔 Message Flagged')
      .setDescription(`${user} reacted with ${TARGET_EMOJI} in <#${message.channel.id}>`)
      .addFields(
        { name: 'Quoted Message', value: msgPreview },
        { name: 'Jump to Message', value: `[Click here to view](${msgLink})` }
      )
      .setFooter({ text: `Message ID: ${message.id}` })
      .setColor(0xFFA500);

    const botMsg = await adminChannel.send({ content: `<@&${roleId}>`, embeds: [embed] });
    await botMsg.react(RESOLVE_EMOJI);
    flaggedMessages[message.id] = botMsg.id;

  } else if (reaction.emoji.name === RESOLVE_EMOJI) {
    if (!member.roles.cache.has(roleId)) return; // not a mod

    // Find original flagged message
    const originalId = Object.keys(flaggedMessages).find(key => flaggedMessages[key] === message.id);
    if (!originalId) return;

    try {
      const originalMsg = await message.channel.messages.fetch(originalId);
      await originalMsg.reactions.resolve(TARGET_EMOJI)?.remove();
    } catch {}

    try {
      await message.delete();
    } catch {}

    delete flaggedMessages[originalId];
  }
});

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setalertchannel')
      .setDescription('Set the channel to receive 🛎 alerts')
      .addChannelOption(option =>
        option.setName('channel').setDescription('The channel to send alerts to').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('setalertrole')
      .setDescription('Set the role to ping when a message is flagged')
      .addRoleOption(option =>
        option.setName('role').setDescription('The role to mention').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('viewalertsettings')
      .setDescription('View the current alert settings')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    const clientId = client.user.id;
    const guilds = client.guilds.cache.map(g => g.id);
    for (const guildId of guilds) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`✅ Registered slash commands for guild ${guildId}`);
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);
