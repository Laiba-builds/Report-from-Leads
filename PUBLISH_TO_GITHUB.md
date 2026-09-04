# Publish Report from Leads on GitHub

## Recommended repository

Repository name: `Report-from-Leads`

Suggested description:

> Chrome extension that reads pasted job leads and builds an editable report with URL, rate, vendor, and job type.

## GitHub web steps

1. On GitHub, create a new repository named `Report-from-Leads`.
2. Keep it **Private** if it is only for your team, or **Public** if anyone may download it.
3. Do not initialize it with another README, license, or `.gitignore` because those files are already included here.
4. Upload all files from this folder to the repository root. `manifest.json` must stay at the repository root.
5. Commit the upload with message `Report from Leads v1.2.5`.
6. Open **Releases** → **Draft a new release**.
7. Tag: `v1.2.5`.
8. Release title: `Report from Leads v1.2.5`.
9. Attach the team package `Report-from-Leads-v1.2.5.zip` as a release asset.
10. Publish the release and share the release page link with the team.

## Team install from the release link

1. Download `Report-from-Leads-v1.2.5.zip` from the release.
2. Extract it.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `Report-from-Leads` folder containing `manifest.json`.

## Updating later

For a new version, replace source files, update the version in `manifest.json`, create a new ZIP, and publish a new GitHub Release/tag. Existing users should replace the files in their current local extension folder and click **Reload** in `chrome://extensions` so their locally saved reports remain available.

## Important

GitHub gives your team a stable download/release link, but Chrome does not install an unpacked extension directly from a normal GitHub page. For true one-click browser installation without Developer mode, publish the extension through the Chrome Web Store.
