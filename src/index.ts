import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, Events,
  EmbedBuilder, REST, Routes, SlashCommandBuilder
} from 'discord.js';
import {
  loadSettings, saveSettings,
  flaggedMessages, TARGET_EMOJI, RESOLVE_EMOJI
} from './settings';

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

let settings = loadSettings();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user!.tag}`);
  await client.guilds.fetch();
  await registerSlashCommands();
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();

    if (user.bot) return;

    const message = reaction.message;
    const guild = message.guild;
    if (!guild) return;

    const gid = guild.id;
    const guildSettings = settings[gid];
    if (!guildSettings) return;

    const roleId = guildSettings.role_id_to_ping;
    const adminChannel = guild.channels.cache.get(guildSettings.admin_channel_id);
    if (!adminChannel?.isTextBased()) return;

    const member = await guild.members.fetch(user.id);

    console.log(`📩 Detected ${reaction.emoji.name} from ${user.tag}`);

    if (reaction.emoji.name === TARGET_EMOJI) {
      if (flaggedMessages[message.id]) return;

      const msgPreview = message.content?.slice(0, 1024) || '[No content]';
      const msgLink = `https://discord.com/channels/${guild.id}/${message.channel.id}/${message.id}`;

      const embed = new EmbedBuilder()
        .setTitle('🔔 Message Flagged')
        .setDescription(`${user} flagged a message in <#${message.channel.id}>`)
        .addFields(
          { name: 'Quoted Message', value: msgPreview },
          { name: 'Jump to Message', value: `[Click here](${msgLink})` }
        )
        .setFooter({ text: `Message ID: ${message.id}` })
        .setColor(0xFFA500);

      const alert = await adminChannel.send({ content: `<@&${roleId}>`, embeds: [embed] });
      await alert.react(RESOLVE_EMOJI);
      flaggedMessages[message.id] = alert.id;

    } else if (reaction.emoji.name === RESOLVE_EMOJI) {
      if (!member.roles.cache.has(roleId)) return;

      const original = Object.entries(flaggedMessages).find(([_, v]) => v === message.id);
      if (!original) return;

      try {
        const originalMsg = await message.channel.messages.fetch(original[0]);
        await originalMsg.reactions.resolve(TARGET_EMOJI)?.remove();
      } catch {}

      try {
        await message.delete();
      } catch {}

      delete flaggedMessages[original[0]];
    }
  } catch (err) {
    console.error('❌ Reaction error:', err);
  }
});

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setalertchannel')
      .setDescription('Set the alert channel')
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Channel to send alerts to').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('setalertrole')
      .setDescription('Set the ping role')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to ping').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('viewalertsettings')
      .setDescription('View current settings')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  try {
    const appId = client.user!.id;
    const guilds = client.guilds.cache.map(g => g.id);
    for (const gid of guilds) {
      await rest.put(Routes.applicationGuildCommands(appId, gid), { body: commands });
      console.log(`✅ Slash commands registered for ${gid}`);
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);