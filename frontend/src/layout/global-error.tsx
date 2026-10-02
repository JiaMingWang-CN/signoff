import { useStore } from "../lib/store";
import { Alert, Button } from "../components";
import { useSearchParams } from "react-router";
import { DEMO_NOTICE_PREFIX, ENTRY_UNAVAILABLE, REPO_URL } from "../api";

// Action failures and unavailable entry notices share the dismissible banner.
export function GlobalError() {
  const s = useStore();
  const [params, setParams] = useSearchParams();
  const message = s.error || (params.get("notice") === "entry-unavailable" ? ENTRY_UNAVAILABLE : "");
  if (!message) return null;
  const demo = message.startsWith(DEMO_NOTICE_PREFIX);
  const notice = demo || message === ENTRY_UNAVAILABLE;
  function close() {
    s.clearError();
    if (params.get("notice") === "entry-unavailable") {
      const next = new URLSearchParams(params);
      next.delete("notice");
      setParams(next, { replace: true });
    }
  }
  return (
    <div className="global-error">
      <Alert
        tone={notice ? "info" : "danger"}
        title={notice ? "提示" : "操作失败"}
        action={
          <>
            {!notice && <Button
              size="sm"
              variant="outline"
              onClick={() => {
                s.clearError();
                s.reload();
              }}
            >
              重试
            </Button>}
            <Button size="sm" variant="ghost" onClick={close}>
              关闭
            </Button>
          </>
        }
      >
        {demo ? (
          <>
            当前为演示版本，请前往仓库进行本地部署：
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {REPO_URL}
            </a>
          </>
        ) : (
          message
        )}
      </Alert>
    </div>
  );
}
