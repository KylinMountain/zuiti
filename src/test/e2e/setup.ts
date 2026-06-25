/**
 * e2e 测试守卫（Plan 7）。
 *
 * e2e 测试调真 MiMo API（花钱、慢），默认跳过。要启用：
 * - .env 配 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
 * - E2E_SKIP=0 npm test（或 npm run test:e2e）
 *
 * CI 默认无 Key，自动跳过。
 *
 * 本模块顶部 loadDotenv，确保 e2e 测试读到 .env 里的 LLM_API_KEY。
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

/** E2E_SKIP !== '0' 时跳过（默认跳过，必须显式 E2E_SKIP=0 才跑）。 */
export const E2E_SKIP = process.env.E2E_SKIP !== '0';

/** 是否有 LLM_API_KEY。 */
export const HAS_LLM_KEY = !!process.env.LLM_API_KEY;

/** e2e 是否应该跑。 */
export const SHOULD_RUN_E2E = !E2E_SKIP && HAS_LLM_KEY;

/** 跳过原因（显示在 test 输出里，空字符串 = 不跳过）。 */
export const SKIP_REASON = E2E_SKIP
  ? 'E2E_SKIP=1（默认跳过；设 E2E_SKIP=0 启用）'
  : HAS_LLM_KEY
    ? ''
    : '无 LLM_API_KEY（.env 未配置）';
