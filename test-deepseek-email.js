#!/usr/bin/env node

// Test script that uses DeepSeek AI to generate real content and send email

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { generateSentence } = require('./services/dailySentence');
const { sendEmailWithTemplate } = require('./services/tencentSes');

async function testDeepSeekEmail() {
    try {
        console.log('🤖 Generating content with DeepSeek AI...');
        
        // Generate real content using DeepSeek
        const sentence = await generateSentence('japanese', 'english', 'B1');
        console.log('Generated content:', JSON.stringify(sentence, null, 2));
        
        // Add level to the sentence data
        sentence.level = 'B1';
        
        console.log('📧 Sending email with DeepSeek content...');
        
        const templateId = Number(process.env.TENCENT_SES_TEMPLATE_ID_EN || 66878);
        const subject = '今日の英語 ' + new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
        
        const ok = await sendEmailWithTemplate('seamuswconnolly@gmail.com', templateId, sentence, subject);
        
        if (ok) {
            console.log('✅ Email sent successfully with DeepSeek content!');
        } else {
            console.log('❌ Failed to send email');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testDeepSeekEmail();
