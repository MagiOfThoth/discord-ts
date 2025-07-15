import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  Events, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  TextBasedChannel, 
  TextChannel 
} from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const TARGET_EMOJI = '🛎️';
const RESOLVE_EMOJI = '✅';
const SETTINGS_FILE = 'settings.json';

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

interface GuildSettings {
  admin_channel_id: string;
  role_id_to_ping: string;
}

interface Settings {
  [guildId: string]: GuildSettings;
}

let settings: Settings = loadSettings();
let flaggedMessages: { [originalMsgId: string]: { alertMsgId: string, channelId: string } } = {};

function loadSettings(): Settings {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
}

function saveSettings(settings: Settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  await client.guilds.fetch();
  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const gid = interaction.guild.id;
  const commandName = interaction.commandName;

  if (commandName === 'setalertchannel') {
    const channel = interaction.options.getChannel('channel');
    if (!channel?.isTextBased()) {
      await interaction.reply({ content: '❌ Please select a text-based channel.', ephemeral: true });
      return;
    }

    settings[gid] = settings[gid] || {} as GuildSettings;
    settings[gid].admin_channel_id = channel.id;
    saveSettings(settings);

    await interaction.reply({ content: `✅ Alert channel set to ${channel}`, ephemeral: true });
    return;
  }

  else if (commandName === 'setalertrole') {
    const role = interaction.options.getRole('role');
    if (!role) {
      await interaction.reply({ content: '❌ Please select a valid role.', ephemeral: true });
      return;
    }

    settings[gid] = settings[gid] || {} as GuildSettings;
    settings[gid].role_id_to_ping = role.id;
    saveSettings(settings);

    await interaction.reply({ content: `✅ Alert role set to ${role}`, ephemeral: true });
    return;
  }

  else if (commandName === 'viewalertsettings') {
    const guildSettings = settings[gid];
    if (!guildSettings) {
      await interaction.reply({ content: `⚠️ No settings found.`, ephemeral: true });
      return;
    }

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
    return;
  }
});

function isTextBasedChannel(channel: any): channel is TextBasedChannel {
  return channel?.isTextBased && typeof channel.isTextBased === 'function' && channel.isTextBased();
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();
    if (user.bot) return;

    const message = reaction.message;
    const guild = message.guild;
    const gid = guild?.id;
    if (!guild || !gid || !settings[gid]) return;

    const roleId = settings[gid].role_id_to_ping;
    const adminChannelId = settings[gid].admin_channel_id;
    const adminChannel = guild.channels.cache.get(adminChannelId);

    // Only proceed if adminChannel is text based
    if (!isTextBasedChannel(adminChannel)) {
      console.warn(`Admin channel ${adminChannelId} is not a text-based channel.`);
      return;
    }

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
        .setColor(0xFFA500);

      console.log(`📢 Sending alert to <#${adminChannel.id}> tagging <@&${roleId}>`);
      const alertMsg = await adminChannel.send({
        content: `<@&${roleId}>`,
        embeds: [embed]
      });

      await alertMsg.react(RESOLVE_EMOJI);
      flaggedMessages[message.id] = {
        alertMsgId: alertMsg.id,
        channelId: message.channel.id
      };

      console.log(`✅ Alert message sent: ${alertMsg.id}`);
    }

    else if (reaction.emoji.name === RESOLVE_EMOJI) {
      const member = await guild.members.fetch(user.id);
      if (!member.roles.cache.has(roleId)) return;

      const originalMsgId = Object.keys(flaggedMessages).find(key => flaggedMessages[key].alertMsgId === message.id);
      if (!originalMsgId) return;

      const originalData = flaggedMessages[originalMsgId];

      try {
        const originalChannel = guild.channels.cache.get(originalData.channelId);
        if (isTextBasedChannel(originalChannel)) {
          const originalMessage = await originalChannel.messages.fetch(originalMsgId);
          await originalMessage.reactions.resolve(TARGET_EMOJI)?.users.remove(client.user!.id);
          console.log(`🗑️ Removed 🛎️ from original message: ${originalMsgId}`);
        }
      } catch (err) {
        console.warn('⚠️ Could not remove 🛎️ from original message', err);
      }

      try {
        await message.delete();
        console.log(`🗑️ Deleted alert message: ${message.id}`);
      } catch (err) {
        console.warn(`⚠️ Failed to delete alert message: ${message.id}`, err);
      }

      delete flaggedMessages[originalMsgId];
    }
  } catch (err) {
    console.error('❌ Reaction handler failed:', err);
  }
});

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setalertchannel')
      .setDescription('Set the channel to receive 🛎️ alerts')
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
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
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

client.login(DISCORD_TOKEN);
