# Report from Leads

Chrome extension for turning pasted job-lead URLs into a clean, editable report.

It reads supported LinkedIn, job-board, ATS, and company-career pages and keeps these fields in one row:

- Lead URL
- Rate
- Vendor name
- Job type

## Current build

Version **1.2.5**.

The non-LinkedIn reader keeps temporary background job pages open for at least 20 seconds so dynamic pages can render, reads the page, and automatically closes temporary tabs as processing completes. LinkedIn uses the existing Smart reader path.

## Install for the team

1. Download the release ZIP from the GitHub Releases page.
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `Report-from-Leads` folder that contains `manifest.json`.
7. Pin **Report from Leads** from Chrome's Extensions menu.

> Do not delete the extracted folder after loading the extension. Chrome needs that folder to keep the unpacked extension available.

## Use

1. Open **Report from Leads**.
2. Paste job URLs, one per line.
3. Click **Read leads & build report**.
4. Review any rows marked **Needs review**.
5. Use **Copy table for Excel** and paste directly into Excel; URL, Rate, Vendor name, and Job type go into separate columns.
6. Use **Remove all leads** before starting the next technology/report when required.

## Updating an existing team install

To keep locally saved reports, do not uninstall the extension. Replace the files in the same local extension folder with the new version, then open `chrome://extensions` and click **Reload** on **Report from Leads**.

## Data and permissions

Reports are stored locally in the user's Chrome profile. The extension requests access to pasted job pages so it can read supported job details. Some dynamic job sites need a real browser page to render; those pages are opened in the extension's background worker flow and closed automatically.

## Sharing through GitHub

For simple team distribution, publish this repository and attach `Report-from-Leads-v1.2.5.zip` to a GitHub Release. Team members can then use one stable release link to download the extension package.

For true one-click Chrome installation without Developer mode, publish through the Chrome Web Store; GitHub itself distributes the ZIP/source but Chrome does not install an unpacked extension directly from a normal GitHub link.
