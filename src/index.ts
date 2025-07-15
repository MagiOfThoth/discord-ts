import dotenv from 'dotenv';
dotenv.config();

import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  Role,
  Interaction,
} from 'discord.js';

import fs from 'fs';

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
let flaggedMessages: { [key: string]: string } = {};

type GuildSettings = {
  admin_channel_id?: string;
  role_id_to_ping?: string;
};

let settings: { [guildId: string]: GuildSettings } = {};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

settings = loadSettings();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user!.tag}`);
  await client.guilds.fetch();
  await registerSlashCommands();
});

// ✅ FIXED InteractionCreate TYPE ERROR HERE
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const gid = interaction.guild.id;
  const command = interaction.commandName;

  if (command === 'setalertchannel') {
    const channel = interaction.options.getChannel('channel') as TextChannel;
    if (!channel || channel.type !== 0) {
      await interaction.reply({ content: '❌ Must be a text channel.', ephemeral: true });
      return;
    }

    settings[gid] = settings[gid] || {};
    settings[gid].admin_channel_id = channel.id;
    saveSettings();
    await interaction.reply({ content: `✅ Alert channel set to ${channel}`, ephemeral: true });
    return;
  }

  if (command === 'setalertrole') {
    const role = interaction.options.getRole('role') as Role;
    if (!role) {
      await interaction.reply({ content: '❌ Role not found.', ephemeral: true });
      return;
    }

    settings[gid] = settings[gid] || {};
    settings[gid].role_id_to_ping = role.id;
    saveSettings();
    await interaction.reply({ content: `✅ Alert role set to ${role}`, ephemeral: true });
    return;
  }

  if (command === 'viewalertsettings') {
    const s = settings[gid];
    if (!s) {
      await interaction.reply({ content: `⚠️ No alert settings found.`, ephemeral: true });
      return;
    }

    const role = interaction.guild.roles.cache.get(s.role_id_to_ping!);
    const channel = interaction.guild.channels.cache.get(s.admin_channel_id!);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Alert Settings')
      .addFields(
        { name: 'Admin Channel', value: channel ? `<#${channel.id}>` : '`[Deleted]`' },
        { name: 'Ping Role', value: role ? `<@&${role.id}>` : '`[Deleted]`' }
      )
      .setColor(0x00ff00);

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();

    if (user.bot) return;

    const { message } = reaction;
    const guild = message.guild;
    const gid = guild?.id;
    if (!gid || !settings[gid]) return;

    const roleId = settings[gid].role_id_to_ping;
    const adminChannelId = settings[gid].admin_channel_id;
    const adminChannel = guild.channels.cache.get(adminChannelId!) as TextChannel;
    const member = await guild.members.fetch(user.id);

    console.log(`📩 Reaction detected: ${reaction.emoji.name} by ${user.tag}`);
    console.log(`🔎 Settings for guild:`, settings[gid]);

    if (reaction.emoji.name === TARGET_EMOJI) {
      if (flaggedMessages[message.id]) return;

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
        .setColor(0xffa500);

      console.log(`📢 Attempting to send alert to channel ${adminChannel?.id} with role ${roleId}`);
      const botMsg = await adminChannel.send({ content: `<@&${roleId}>`, embeds: [embed] });
      console.log(`✅ Alert sent as message ${botMsg.id}`);
      await botMsg.react(RESOLVE_EMOJI);
      flaggedMessages[message.id] = botMsg.id;
    }

    if (reaction.emoji.name === RESOLVE_EMOJI) {
      if (!member.roles.cache.has(roleId!)) return;

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
  } catch (err) {
    console.error('❌ Reaction handler failed:', err);
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

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  try {
    const clientId = client.user!.id;
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
