/* ===== lib/sms.js — 腾讯云短信发送封装 ===== */

const tencentcloud = require('tencentcloud-sdk-nodejs-sms');

const SmsClient = tencentcloud.sms.v20210111.Client;

async function sendSmsOtp(phone, code) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const appId = process.env.TENCENT_SMS_APP_ID;
  const sign = process.env.TENCENT_SMS_SIGN;
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID;

  // 缺少配置时只打印到控制台（本地开发调试）
  if (!secretId || !secretKey || !appId || !sign || !templateId) {
    console.log(`[SMS DEV] 手机号 ${phone} 验证码：${code}`);
    return { ok: true, dev: true };
  }

  const client = new SmsClient({
    credential: { secretId, secretKey },
    region: 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
  });

  const params = {
    SmsSdkAppId: appId,
    SignName: sign,
    TemplateId: templateId,
    TemplateParamSet: [code],
    PhoneNumberSet: [`+86${phone}`],
  };

  const result = await client.SendSms(params);
  const sendStatus = result.SendStatusSet?.[0];
  if (sendStatus && sendStatus.Code !== 'Ok') {
    throw new Error(`SMS send failed: ${sendStatus.Code} ${sendStatus.Message}`);
  }
  return { ok: true };
}

module.exports = { sendSmsOtp };
