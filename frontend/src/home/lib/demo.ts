import { useNavigate } from "react-router";
import { api, type Repo } from "../../api";
import { useStore } from "../../lib/store";

export const DEMO_BUSY = "demo";

// 与旧首页一致：真实导入示例仓库，成功后选中并进入概览页。
export function useEnterDemo() {
  const s = useStore();
  const navigate = useNavigate();
  return {
    busy: s.busy === DEMO_BUSY,
    disabled: !!s.busy,
    async enter() {
      const repo = await s.perform(DEMO_BUSY, () => api<Repo>("/repos/import", {}));
      if (repo) {
        s.select(repo.id);
        s.reload();
        navigate("/overview");
      }
    },
  };
}
