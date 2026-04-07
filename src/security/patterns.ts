// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export interface SecretPattern {
  name: string
  pattern: RegExp
  envVarName: string
  severity: 'critical' | 'high' | 'medium'
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'Anthropic API Key',
    pattern: /sk-ant-api03-[a-zA-Z0-9_-]{93}/g,
    envVarName: 'ANTHROPIC_API_KEY',
    severity: 'critical',
  },
  {
    name: 'Anthropic OAuth',
    pattern: /sk-ant-oat01-[a-zA-Z0-9_-]+/g,
    envVarName: 'ANTHROPIC_OAUTH_TOKEN',
    severity: 'critical',
  },
  {
    name: 'OpenAI API Key',
    pattern: /sk-[a-zA-Z0-9]{48}/g,
    envVarName: 'OPENAI_API_KEY',
    severity: 'critical',
  },
  {
    name: 'OpenAI Project Key',
    pattern: /sk-proj-[a-zA-Z0-9_-]+/g,
    envVarName: 'OPENAI_API_KEY',
    severity: 'critical',
  },
  {
    name: 'GitHub Personal Token',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    envVarName: 'GITHUB_TOKEN',
    severity: 'high',
  },
  {
    name: 'GitHub OAuth Token',
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    envVarName: 'GITHUB_TOKEN',
    severity: 'high',
  },
  {
    name: 'GitHub Actions Token',
    pattern: /ghs_[a-zA-Z0-9]{36}/g,
    envVarName: 'GITHUB_TOKEN',
    severity: 'high',
  },
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    envVarName: 'AWS_ACCESS_KEY_ID',
    severity: 'critical',
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?:aws_secret|AWS_SECRET)[^a-zA-Z0-9]*[=:]\s*["']?([0-9a-zA-Z/+]{40})["']?/gi,
    envVarName: 'AWS_SECRET_ACCESS_KEY',
    severity: 'critical',
  },
  {
    name: 'Google API Key',
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    envVarName: 'GOOGLE_API_KEY',
    severity: 'high',
  },
  {
    name: 'Slack Bot Token',
    pattern: /xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}/g,
    envVarName: 'SLACK_BOT_TOKEN',
    severity: 'high',
  },
  {
    name: 'Slack User Token',
    pattern: /xoxp-[0-9a-zA-Z-]+/g,
    envVarName: 'SLACK_USER_TOKEN',
    severity: 'high',
  },
  {
    name: 'Stripe Live Key',
    pattern: /sk_live_[0-9a-zA-Z]{24,}/g,
    envVarName: 'STRIPE_SECRET_KEY',
    severity: 'critical',
  },
  {
    name: 'Stripe Test Key',
    pattern: /sk_test_[0-9a-zA-Z]{24,}/g,
    envVarName: 'STRIPE_TEST_KEY',
    severity: 'medium',
  },
  {
    name: 'Twilio Account SID',
    pattern: /AC[a-zA-Z0-9]{32}/g,
    envVarName: 'TWILIO_ACCOUNT_SID',
    severity: 'high',
  },
  {
    name: 'Twilio Auth Token',
    pattern: /(?:twilio)[^a-zA-Z0-9]*(?:auth)?[^a-zA-Z0-9]*(?:token)?[^a-zA-Z0-9]*[=:]\s*["']?([a-zA-Z0-9]{32})["']?/gi,
    envVarName: 'TWILIO_AUTH_TOKEN',
    severity: 'high',
  },
  {
    name: 'SendGrid Key',
    pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,
    envVarName: 'SENDGRID_API_KEY',
    severity: 'high',
  },
  {
    name: 'Firebase Token',
    pattern: /[0-9]+-[a-zA-Z0-9_]{32}\.apps\.googleusercontent\.com/g,
    envVarName: 'FIREBASE_TOKEN',
    severity: 'high',
  },
  {
    name: 'Vercel Token',
    pattern: /(?:vercel)[^a-zA-Z0-9]*(?:token)?[^a-zA-Z0-9]*[=:]\s*["']?([a-zA-Z0-9]{24})["']?/gi,
    envVarName: 'VERCEL_TOKEN',
    severity: 'medium',
  },
  {
    name: 'Supabase Key',
    pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    envVarName: 'SUPABASE_KEY',
    severity: 'high',
  },
]
