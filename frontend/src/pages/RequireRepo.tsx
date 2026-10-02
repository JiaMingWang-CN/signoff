import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { FolderGit2 } from "lucide-react";
import { api, type Repo } from "../api";
import { useStore } from "../lib/store";
import { statusText, statusTone } from "../lib/utils";
import {
  Badge,
  BusyButton,
  Button,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Code,
  Dialog,
  Empty,
  Notice,
  Page,
  PageHeader,
} from "../components";

const stepNames = ["克隆到工作区", "codegraph 建立索引", "同步 Issue"];

// Import progress for a repository that is not ready yet.
export function Progress({ repo }: { repo: Repo }) {
  const [output, setOutput] = useState<{ step: string; text: string } | null>(
    null,
  );
  return (
    <Card>
      <CardHeader title="导入进度" />
      <CardBody>
        {["clone", "index", "issues"].map((step, i) => {
          const entry = repo.progress.find((p) => p.step === step);
          const done = entry?.status === "complete";
          return (
            <div className="progress-row" key={step}>
              <Badge tone={done ? "success" : entry ? "info" : "muted"}>
                {i + 1}
              </Badge>
              <span>{stepNames[i]}</span>
              <span className="muted">{entry?.status || "等待中"}</span>
              <span className="spacer" />
              {entry?.output && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOutput({ step, text: entry.output || "" })}
                >
                  {step} 输出
                </Button>
              )}
            </div>
          );
        })}
      </CardBody>
      {output && (
        <Dialog
          size="wide"
          title={output.step + " 输出"}
          onClose={() => setOutput(null)}
        >
          <Code text={output.text} />
        </Dialog>
      )}
    </Card>
  );
}

export default function RequireRepo({ children }: { children: ReactNode }) {
  const s = useStore();
  if (!s.repo)
    return (
      <Page>
        <Empty
          icon={<FolderGit2 />}
          title="还没有选择仓库"
          action={
            <Link className={buttonVariants({ size: "sm" })} to="/repos">
              选择并导入仓库
            </Link>
          }
        >
          导入仓库后即可检索代码、扫描漏洞并安排任务。
        </Empty>
      </Page>
    );
  if (s.repo.status !== "ready")
    return (
      <Page>
        <PageHeader
          title={s.repo.name}
          description={
            <Badge tone={statusTone(s.repo.status)} dot>
              {statusText[s.repo.status] || s.repo.status}
            </Badge>
          }
        >
          <BusyButton
            label="sync"
            onClick={() =>
              void s.perform("sync", async () => {
                await api("/repos/" + s.repo!.id + "/sync", {});
                s.reload();
              })
            }
          >
            重新同步
          </BusyButton>
        </PageHeader>
        <div className="page-body">
          <Progress repo={s.repo} />
          {s.repo.error && <Notice error>{s.repo.error}</Notice>}
        </div>
      </Page>
    );
  return <Fragment key={s.repo.id}>{children}</Fragment>;
}
