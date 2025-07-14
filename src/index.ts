client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (user.partial) await user.fetch();

    if (user.bot) return;

    const { message } = reaction;
    const guild = message.guild;
    const gid = guild?.id;
    if (!gid || !settings[gid]) {
      console.log('⚠️ Guild not found or no settings set.');
      return;
    }

    const roleId = settings[gid].role_id_to_ping;
    const adminChannelId = settings[gid].admin_channel_id;

    if (!roleId || !adminChannelId) {
      console.log('⚠️ Missing roleId or adminChannelId in settings:', settings[gid]);
      return;
    }

    const adminChannel = guild.channels.cache.get(adminChannelId);
    if (!adminChannel || !adminChannel.isTextBased()) {
      console.log(`❌ Admin channel not found or not text-based: ${adminChannelId}`);
      return;
    }

    const member = await guild.members.fetch(user.id);
    const emoji = reaction.emoji.name;

    console.log(`📩 Reaction detected: ${emoji} by ${user.tag}`);
    console.log(`🔎 Settings for guild ${gid}:`, settings[gid]);

    if (emoji === TARGET_EMOJI) {
      if (flaggedMessages[message.id]) {
        console.log(`🛑 Message ${message.id} already flagged.`);
        return;
      }

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

      try {
        const botMsg = await adminChannel.send({
          content: `<@&${roleId}>`,
          embeds: [embed]
        });
        await botMsg.react(RESOLVE_EMOJI);
        flaggedMessages[message.id] = botMsg.id;
        console.log(`✅ Alert sent to ${adminChannel.name} with message ID ${botMsg.id}`);
      } catch (err) {
        console.error(`❌ Failed to send alert to channel ${adminChannelId}:`, err);
      }

    } else if (emoji === RESOLVE_EMOJI) {
      if (!member.roles.cache.has(roleId)) {
        console.log(`🔒 User ${user.tag} does not have the required role to resolve.`);
        return;
      }

      const originalId = Object.keys(flaggedMessages).find(key => flaggedMessages[key] === message.id);
      if (!originalId) {
        console.log(`⚠️ No original message found for flagged alert ${message.id}`);
        return;
      }

      try {
        const originalMsg = await message.channel.messages.fetch(originalId);
        await originalMsg.reactions.resolve(TARGET_EMOJI)?.remove();
        await message.delete();
        delete flaggedMessages[originalId];
        console.log(`✅ Flagged message ${originalId} resolved and alert deleted.`);
      } catch (err) {
        console.error(`❌ Failed to resolve/delete flagged alert:`, err);
      }
    }
  } catch (err) {
    console.error('❌ Reaction handler error:', err);
  }
});
