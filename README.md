This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

The login screen offers two profiles: **Direction** and **Employé**. Configure
`APP_DIRECTION_PASSWORD` and `APP_EMPLOYEE_PASSWORD` in `.env.local` (or in the
hosting environment), then restart the server. The former `APP_PASSWORD` remains
a fallback for Direction only. Existing sessions must log in again.

Both profiles can consult anomalies, report new ones, and carry out rounds.
Only Direction can edit an existing anomaly, record an intervention, or change
its status. These permissions are enforced by the API as well as the interface.

New anomalies accept up to **3 photos total**, taken consecutively with the
camera or selected together. Photos can be removed before saving. Existing
single-photo records remain readable without a migration.

When using Google Sheets, update `google-apps-script/Code.gs` in the bound Apps
Script project and deploy a new version of the existing web app before using
multiple photos. Keep the existing spreadsheet, API token, and photo folder.
The photo column will contain the links to all attached photos.

Google reads now share concurrent requests and cache the hotel data for 15 seconds
and photo bytes for 15 minutes (up to 32 MiB per server process). The **Actualiser**
button bypasses the data cache; saves invalidate it. Read requests retry once on
transient network errors or temporary Google failures. Writes are never retried
automatically. Photos remain authenticated, and failed images offer a retry button.
These application changes work with the existing three-photo Apps Script deployment;
publish a new application build to make them available on phones using the hosted site.
Process caches reset when a server restarts and are not shared between hosting instances.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
