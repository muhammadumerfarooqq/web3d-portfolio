// Contact email through Gmail SMTP (nodemailer), plain text only. The visitor's validated address goes
// in Reply-To, never in From (Gmail would reject spoofed senders and we must not relay mail "as" them).
// The schema already forbids CR/LF in every header field; buildMail checks again (defence in depth).

export const SMTP = { host: 'smtp.gmail.com', port: 465, secure: true };

const HEADER_BREAK = /[\r\n\u0085\u2028\u2029]/;

export function createMailer(createTransport, { user, pass }) {
  return createTransport({
    ...SMTP,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** The message for nodemailer. data: the validated { name, email, subject, message }. */
export function buildMail({ from, to, data, receivedAt }) {
  for (const k of ['name', 'email', 'subject']) {
    if (HEADER_BREAK.test(data[k])) throw new Error(`header break in ${k}`);
  }
  return {
    from: { name: 'Portfolio contact form', address: from },
    to,
    replyTo: { name: data.name, address: data.email },
    subject: `[Portfolio] ${data.subject} from ${data.name}`,
    text: [
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Subject: ${data.subject}`,
      `Received: ${new Date(receivedAt).toISOString()}`,
      '',
      data.message,
      '',
      '--',
      'Sent from the contact form on the portfolio. Reply to this email to answer the visitor.',
    ].join('\n'),
  };
}
