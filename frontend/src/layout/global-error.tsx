import { useStore } from "../lib/store";
import { Alert, Button } from "../components";

// Failures from actions and from background polling, with a retry.
export function GlobalError() {
  const s = useStore();
  if (!s.error) return null;
  return (
    <div className="global-error">
      <Alert
        tone="danger"
        title="操作失败"
        action={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                s.clearError();
                s.reload();
              }}
            >
              重试
            </Button>
            <Button size="sm" variant="ghost" onClick={s.clearError}>
              关闭
            </Button>
          </>
        }
      >
        {s.error}
      </Alert>
    </div>
  );
}
