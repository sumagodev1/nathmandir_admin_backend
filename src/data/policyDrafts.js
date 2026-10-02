// ─────────────────────────────────────────────────────────────
// Starter text for the Privacy Policy and Terms & Conditions.
//
// Inserted by `node scripts/add-policies.js --with-drafts`, and only for a
// type that has no row yet, so it never overwrites what an admin wrote.
//
// Written from what this backend really does: OTP login by mobile number,
// the fields `register` and the contact form collect, the one-device rule,
// Razorpay for purchases and donations, play counts, and lifetime access on
// a purchased module. It is a DRAFT. The temple trust should read it, and
// have it checked, before relying on it — especially the refund section.
// ─────────────────────────────────────────────────────────────

const CONTACT = `
<p><strong>Shri Madhavnath Mandir, Nashik</strong><br>
Lam Road, Vihitgaon, Nashik Road, Nashik, Maharashtra 422101, India<br>
Email: <a href="mailto:nathmandirnashik@gmail.com">nathmandirnashik@gmail.com</a><br>
Phone: <a href="tel:+919370202211">+91 93702 02211</a>, <a href="tel:+919545454443">+91 95454 54443</a></p>`

export const PRIVACY_DRAFT = {
  title: 'Privacy Policy',
  content: `
<p>This Privacy Policy explains how Shri Madhavnath Mandir, Nashik ("the Mandir", "we", "us") collects, uses and protects your information when you use the Shreenath Gitanjali mobile app and the website nathmandirnashik.com (together, "the Services").</p>

<h2>1. Information we collect</h2>
<h3>Information you give us</h3>
<ul>
  <li><strong>Account details:</strong> your name, mobile number, city, and optionally your email address and postal address, when you register.</li>
  <li><strong>Contact messages:</strong> your name, email, phone number, subject and message, when you write to us through the website.</li>
  <li><strong>Donations and purchases:</strong> the amount, the module or cause, and the payment reference.</li>
</ul>
<h3>Information collected automatically</h3>
<ul>
  <li><strong>Device identifier:</strong> an ID for the phone you log in on. We use it so one account stays active on one device at a time.</li>
  <li><strong>Login records:</strong> the date and time you log in.</li>
  <li><strong>Usage:</strong> which songs and texts are played, used to count plays.</li>
</ul>
<h3>Payment information</h3>
<p>Payments are processed by <strong>Razorpay</strong>. Your card, UPI or bank details are entered on Razorpay's secure page and are <strong>never stored by us</strong>. We receive only the payment status, amount and transaction reference.</p>

<h2>2. How we use your information</h2>
<ul>
  <li>To create your account and log you in with a one-time password (OTP) sent by SMS.</li>
  <li>To give you access to the modules you have purchased.</li>
  <li>To record donations and issue receipts.</li>
  <li>To keep your account secure and active on one device.</li>
  <li>To answer your messages and send important notices about the Services.</li>
  <li>To understand which content is used, so we can improve it.</li>
</ul>
<p>We do <strong>not</strong> sell, rent or trade your personal information.</p>

<h2>3. Sharing your information</h2>
<p>We share information only with the service providers we need to run the Services, and only what they need:</p>
<ul>
  <li><strong>Razorpay</strong>, to process payments.</li>
  <li><strong>Our SMS provider</strong>, to deliver login OTPs to your mobile number.</li>
  <li><strong>Our hosting provider</strong>, which stores our data on secure servers.</li>
</ul>
<p>We may also disclose information when required by law or by a lawful order of an Indian authority.</p>

<h2>4. Data security</h2>
<p>Data is sent over encrypted connections (HTTPS). Access to the admin panel is limited to authorised Mandir staff. No method of storage or transmission is completely secure, but we take reasonable steps to protect your information.</p>

<h2>5. Data retention</h2>
<p>We keep your account information for as long as your account is active, and payment and donation records for as long as required by Indian tax and accounting law.</p>

<h2>6. Your rights</h2>
<p>You can ask us to see, correct or delete your personal information, or to close your account, by contacting us using the details below. Some records, such as donation receipts, may have to be kept to meet legal obligations.</p>

<h2>7. Children</h2>
<p>The Services are meant for a general devotional audience. We do not knowingly collect personal information from children under 13 without the consent of a parent or guardian.</p>

<h2>8. Changes to this policy</h2>
<p>We may update this policy from time to time. The version number and "last updated" date show the current version. When the policy changes, the app may ask you to review and accept it again.</p>

<h2>9. Contact us</h2>
${CONTACT}
`.trim(),
}

export const TERMS_DRAFT = {
  title: 'Terms & Conditions',
  content: `
<p>These Terms &amp; Conditions ("Terms") govern your use of the Shreenath Gitanjali mobile app and the website nathmandirnashik.com (together, "the Services"), run by Shri Madhavnath Mandir, Nashik ("the Mandir", "we", "us"). By using the Services, you agree to these Terms.</p>

<h2>1. Your account</h2>
<ul>
  <li>You log in with your mobile number and a one-time password (OTP). Please give correct details when you register.</li>
  <li>An account can be active on <strong>one device at a time</strong>. Logging in on a new device logs out the old one.</li>
  <li>You are responsible for activity on your account. Do not share your OTP with anyone.</li>
  <li>We may suspend or disable an account that is misused or that breaks these Terms.</li>
</ul>

<h2>2. Content and its use</h2>
<ul>
  <li>The aartis, padas, stotras, audio recordings, lyrics, books, photos and other content are owned by the Mandir or used with permission.</li>
  <li>The content is for your <strong>personal, devotional, non-commercial use</strong> only.</li>
  <li>You may not copy, record, re-upload, distribute, sell or broadcast the content without written permission from the Mandir.</li>
</ul>

<h2>3. Purchases</h2>
<ul>
  <li>Some modules, such as Gitanjali Part 1, Gitanjali Part 2, Upasana and Nityaniyam, are paid. The price is shown before you pay.</li>
  <li>Payments are processed securely by Razorpay. Access to a purchased module is linked to your account (your mobile number) and is given once the payment is confirmed.</li>
  <li>Unless stated otherwise at the time of purchase, access to a purchased module does not expire.</li>
</ul>

<h2>4. Refunds</h2>
<p>Purchases are for digital devotional content that is available immediately, so they are generally <strong>not refundable</strong>. If you were charged but did not receive access, or were charged twice for the same module, contact us with your payment reference within 7 days and we will restore your access or refund the duplicate charge.</p>

<h2>5. Donations</h2>
<p>Donations made through the Services are voluntary offerings to the Mandir and are <strong>not refundable</strong>, except for a payment made by mistake that you report to us promptly. Receipts are issued for donations.</p>

<h2>6. Acceptable use</h2>
<p>You agree not to misuse the Services: for example, not to attempt to bypass payment or device limits, access other users' accounts, disrupt the Services, or use them for any unlawful purpose.</p>

<h2>7. Availability</h2>
<p>We work to keep the Services available, but we do not guarantee they will always be uninterrupted or error-free. We may add, change or remove content and features.</p>

<h2>8. Limitation of liability</h2>
<p>The Services are provided "as is". To the extent permitted by law, the Mandir is not liable for any indirect or consequential loss arising from the use of the Services. Our total liability for any claim is limited to the amount you paid for the module concerned.</p>

<h2>9. Privacy</h2>
<p>How we handle your personal information is explained in our Privacy Policy.</p>

<h2>10. Changes to these Terms</h2>
<p>We may update these Terms from time to time. The version number and "last updated" date show the current version. When the Terms change, the app may ask you to review and accept them again. Continuing to use the Services after a change means you accept the new Terms.</p>

<h2>11. Governing law</h2>
<p>These Terms are governed by the laws of India. Any dispute is subject to the jurisdiction of the courts at Nashik, Maharashtra.</p>

<h2>12. Contact us</h2>
${CONTACT}
`.trim(),
}
