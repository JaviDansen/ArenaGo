import { runAsCampaignChild } from "./campaign-child-protocol";

// Fixed worker for testing IPC with an inert process. It cannot load application or suite code.
if (require.main === module) {
  const [, , suite, campaignId, referenceSha256] = process.argv;
  void runAsCampaignChild(suite, { campaignId, referenceSha256 }, async () => {
    if (process.env.NODE_OPTIONS || process.env.PGHOST || process.env.RESEND_API_KEY
        || process.env.NODE_V8_COVERAGE || process.env.DOTENV_CONFIG_OVERRIDE
        || process.env.EVENT_CLOSURE_JOB_TEST_ENABLED !== "false"
        || process.cwd().toLowerCase() !== __dirname.replace(/[\\/]test[\\/]infrastructure$/iu, "").toLowerCase()
        || process.argv.length !== 5) throw new Error();
    return { passed: 1, failed: 0, skipped: 0, cancelled: 0 };
  }).then(code => { process.exitCode = code; }, () => { process.exitCode = 2; });
}
