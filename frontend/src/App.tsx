import { Component, type ReactNode, Suspense, lazy } from "react";
import { Route, Routes, useNavigate } from "react-router";
import { Button, Notice } from "./components";
import { GlobalError } from "./layout/global-error";
import Shell, { Toaster } from "./layout/shell";
import { StoreProvider } from "./lib/store";

// The animated marketing homepage carries the whole GSAP graph (~250 kB
// gzipped); workbench users should not download it, and the chunk loads only
// for the "/" route.
const Home = lazy(() => import("./home/Home"));

// A render-time crash in one page used to blank the whole application and
// leave no way back; the boundary keeps the rest reachable.
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("页面渲染失败", error, info);
  }

  render() {
    return this.state.failed ? <CrashFallback /> : this.props.children;
  }
}

function CrashFallback() {
  const navigate = useNavigate();
  return (
    <main className="page-body">
      <div className="card">
        <div className="card-body stack">
          <Notice error>页面渲染出错，数据未丢失，可重试或回到首页。</Notice>
          <div className="row">
            <Button variant="outline" onClick={() => navigate("/")}>
              回首页
            </Button>
            <Button onClick={() => window.location.reload()}>重新加载页面</Button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={null}>
                <Home />
              </Suspense>
            }
          />
          <Route path="*" element={<Shell />} />
        </Routes>
      </ErrorBoundary>
      <Toaster />
      <GlobalError />
    </StoreProvider>
  );
}