const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Configuration - Set these as environment variables
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your_verify_token_here';
const APP_SECRET = process.env.APP_SECRET || 'your_facebook_app_secret';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'your_discord_webhook_url';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'your_page_access_token';

// Verify Facebook webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Verify request signature
function verifySignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    throw new Error('No signature');
  }
  const elements = signature.split('=');
  const signatureHash = elements[1];
  const expectedHash = crypto.createHmac('sha256', APP_SECRET)
    .update(buf)
    .digest('hex');
  
  if (signatureHash !== expectedHash) {
    throw new Error('Invalid signature');
  }
}

// Handle Facebook webhook events
app.post('/webhook', express.json({ verify: verifySignature }), async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === 'feed') {
          await handleFeedUpdate(change.value);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// Process feed updates and send to Discord
async function handleFeedUpdate(value) {
  try {
    const postId = value.post_id;
    const verb = value.verb; // 'add', 'edited', 'remove'
    
    if (verb === 'remove') {
      await sendToDiscord({
        content: '🗑️ A post was deleted from the Facebook page.'
      });
      return;
    }

    // Get full post details from Facebook Graph API
    const postDetails = await axios.get(
      `https://graph.facebook.com/v18.0/${postId}`,
      {
        params: {
          fields: 'message,created_time,full_picture,permalink_url,attachments{media,type,url}',
          access_token: PAGE_ACCESS_TOKEN
        }
      }
    );

    const post = postDetails.data;
    
    // Build Discord embed
    const embed = {
      title: verb === 'add' ? '📢 New Facebook Post' : '✏️ Post Updated',
      description: post.message || 'No text content',
      url: post.permalink_url,
      color: verb === 'add' ? 0x1877f2 : 0xffa500, // Facebook blue or orange
      timestamp: post.created_time,
      footer: {
        text: 'Facebook Page Update'
      }
    };

    // Add image if present
    if (post.full_picture) {
      embed.image = { url: post.full_picture };
    }

    // Handle multiple attachments (albums, videos, etc.)
    if (post.attachments && post.attachments.data) {
      const attachment = post.attachments.data[0];
      if (attachment.type === 'video_inline') {
        embed.fields = [{
          name: '🎥 Video',
          value: 'This post contains a video. Click the link above to view.'
        }];
      } else if (attachment.type === 'album') {
        embed.fields = [{
          name: '🖼️ Photo Album',
          value: `This post contains ${attachment.media?.length || 'multiple'} photos.`
        }];
      }
    }

    await sendToDiscord({ embeds: [embed] });
    
  } catch (error) {
    console.error('Error processing feed update:', error.response?.data || error.message);
  }
}

// Send message to Discord
async function sendToDiscord(payload) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log('Sent to Discord successfully');
  } catch (error) {
    console.error('Error sending to Discord:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
