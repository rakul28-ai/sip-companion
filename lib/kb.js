// Knowledge base for the assistant. Each fact is a short paraphrase of the cited public page,
// checked 25 to 27 Oct 2026. K3 and K5 are secondary sources and must be replaced before production.
// K6 is first-hand observation of the Groww app (fellow's screenshots, 26 Oct 2026) and has no public URL.
const KB = [
  {
    id: 'K1',
    title: 'Groww Help: pause (skip) upcoming SIPs',
    url: 'https://groww.in/help/mutual-funds/order/can-i-pause-sip-for-next-month',
    status: 'official',
    text: 'On Groww you can skip an upcoming SIP instalment: open My SIPs, select the SIP, tap Edit SIP, choose Skip Installment, check the month shown on the confirmation pop-up, and confirm. The help page does not state a limit on the number of skips.'
  },
  {
    id: 'K2',
    title: 'Groww Blog: How to edit an SIP on Groww',
    url: 'https://groww.in/blog/how-to-edit-sip-on-groww',
    status: 'official',
    text: 'You can change the amount and the date of an existing SIP on Groww: go to the mutual fund dashboard, choose SIPs, select the SIP, tap Edit SIP, choose Edit Amount & Date, adjust the amount and/or date and save changes. You can also choose Skip Installment from the same menu; after a skip, your investments continue as usual.'
  },
  {
    id: 'K3',
    title: 'SEBI rule on SIP auto-cancellation (as documented by Fintech Primitives)',
    url: 'https://docs.fintechprimitives.com/compliance/changes/sip-auto-cancellation/',
    status: 'secondary',
    text: 'Under a SEBI letter dated 3 January 2024 (SEBI/HO/OW/IMD/IMD-SEC1/P/2024/270/1), a monthly SIP is cancelled after 3 consecutive failed instalments. For quarterly, half-yearly and yearly SIPs the limit is 2. The platform provider documenting this rule counts consecutive failed or skipped instalments toward the limit.'
  },
  {
    id: 'K4',
    title: 'Edelweiss Mutual Fund: How to stop or pause an SIP',
    url: 'https://www.edelweissmf.com/investor-insights/mutual-fund-investment-tips-and-articles/how-to-stop-or-pause-an-sip',
    status: 'fund house',
    text: 'Pausing a SIP does not affect your mutual fund balance. If you stop a SIP, you continue to own the units bought so far and their value keeps moving with the market. To invest through a SIP again after stopping, you register a new SIP. Pause durations allowed vary by fund house, typically from three months to one year, and pausing may be allowed only a limited number of times.'
  },
  {
    id: 'K5',
    title: 'Kuvera: What happens if you stop your SIP for 6 months?',
    url: 'https://kuvera.in/blog/what-happens-if-you-stop-your-sip-for-6-months/',
    status: 'secondary',
    text: 'Existing units remain invested unless you redeem them. Mutual fund houses do not charge penalties for missed SIP instalments, but your bank may levy a bounce charge when an instalment fails because of insufficient balance. Starting again after stopping requires a fresh SIP registration.'
  },
  {
    id: 'K6',
    title: 'Groww app: SIP details screen (observed 26 Oct 2026)',
    url: '',
    status: 'observed in app',
    text: 'In the Groww app (observed 26 Oct 2026), the SIP details page lists the upcoming instalment with a Skip link next to it. Tapping Skip asks to confirm the instalment date and shows the next due date. The same page has Change amount/date and Cancel SIP. A changed amount applies to all following instalments until it is changed again.'
  },
  {
    id: 'K7',
    title: 'HDFC Mutual Fund: SIP Pause facility form (July 2026)',
    url: 'https://files.hdfcfund.com/s3fs-public/2026-07/SIP%20Pause%20Form%20150726.pdf',
    status: 'fund house',
    text: 'At HDFC Mutual Fund, up to 3 consecutive monthly SIP instalments can be paused, the pause facility can be used multiple times, the request must be submitted at least 15 days before the pause starts, and the SIP resumes automatically after the pause. Other fund houses set their own pause limits.'
  },
  {
    id: 'K8',
    title: 'HSBC Mutual Fund: SIP pause and cancellation form (Feb 2025)',
    url: 'https://www.assetmanagement.hsbc.co.in/assets/documents/mutual-funds/en/cc000971-5e8a-48b4-9876-05e2ec0c1ecd/hsbc-sip-pause-and-cancellation-form.pdf',
    status: 'fund house',
    text: 'At HSBC Mutual Fund, from 1 December 2024 a SIP cancellation takes effect within 2 business days of a valid request, and an instalment due within that window may still be debited. If 3 consecutive monthly SIP debits are dishonoured for insufficient funds (2 for quarterly or longer SIPs), the fund house can discontinue the SIP.'
  }
];
const KB_IDS = KB.map(k => k.id);
const kbById = id => KB.find(k => k.id === id);
module.exports = { KB, KB_IDS, kbById };
