const nodemailer = require("nodemailer");
const { google } = require('googleapis');
const https = require('https')

const EMAIL_USER = process.env.EMAIL_USER
const EMAIL_CLIENT_ID = process.env.EMAIL_CLIENT_ID
const EMAIL_CLIENT_SECRET = process.env.EMAIL_CLIENT_SECRET
const EMAIL_REDIRECT_URL = process.env.EMAIL_REDIRECT_URL
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD

  

class EmailClient {
    constructor() {
        // Create a transporter object using your Gmail SMTP credentials
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_APP_PASSWORD
            }
        });

        const oAuth2Client = new google.auth.OAuth2(
            process.env.EMAIL_CLIENT_ID,
            process.env.EMAIL_CLIENT_SECRET,
            process.env.EMAIL_REDIRECT_URL
        );
        this.transporter = transporter
        this.oAuth2Client = oAuth2Client
    }

    async sendEmail(subject, text) {
        try {
            await transporter.sendMail({
                from: EMAIL_USER,
                to: EMAIL_USER,
                subject: subject,
                text: text
            });

        } catch (err) {
            console.log(err);
        }
    }
}

module.exports = EmailClient;