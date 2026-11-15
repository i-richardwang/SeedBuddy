import type { Phase } from "./supervisor";

/** The words the app itself says, outside the workbench it opens. */
interface Messages {
  /** The language these words are in, as a page declares it. */
  lang: string;
  phase(phase: Phase): string;
  /** What the menu says while the app is connected to no workbench. */
  noWorkbench: string;
  serve: string;
  open: string;
  changeWorkbench: string;
  /** Offers the later version of the app that has been published. */
  download(version: string): string;
  quit: string;
  /** The page that asks which workbench to open. */
  connectHeading: string;
  connectHint: string;
  connect: string;
  refused(address: string): string;
  /** The question a page with unsaved work has the app ask before it goes. */
  leaveHeading: string;
  leaveDetail: string;
  leave: string;
  stay: string;
}

/** A reason's last line, where a command says what failed, cut to fit a menu. */
function brief(detail: string): string {
  const line = detail.trimEnd().split("\n").at(-1) ?? "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

const en: Messages = {
  lang: "en",
  phase(phase) {
    switch (phase.kind) {
      case "off":
        return "Not serving as a Worker";
      case "signed-out":
        return "Sign in to serve as a Worker";
      case "unavailable":
        return "This workbench ships no Worker package";
      case "installing":
        return "Installing the Worker package…";
      case "starting":
        return "Starting the Worker…";
      case "running":
        return "Serving as a Worker";
      case "training":
        return "Training";
      case "suspended":
        return "Your account is suspended";
      case "removed":
        return "Removed from the workbench's Workers";
      case "failed":
        return `Not serving: ${brief(phase.detail)}`;
    }
  },
  noWorkbench: "Not connected to a workbench",
  serve: "Use this computer as a Worker",
  open: "Open SeedBuddy",
  changeWorkbench: "Change workbench…",
  download: (version) => `Download SeedBuddy ${version}…`,
  quit: "Quit SeedBuddy",
  connectHeading: "Connect to a workbench",
  connectHint: "Enter the address of your SeedBuddy workbench.",
  connect: "Connect",
  refused: (address) => `No SeedBuddy workbench answers at ${address}`,
  leaveHeading: "Leave this page?",
  leaveDetail: "Changes you made may not be saved.",
  leave: "Leave",
  stay: "Stay",
};

const zh: Messages = {
  lang: "zh-CN",
  phase(phase) {
    switch (phase.kind) {
      case "off":
        return "未作为计算节点运行";
      case "signed-out":
        return "登录后开始作为计算节点运行";
      case "unavailable":
        return "这个工作台没有自带计算节点程序";
      case "installing":
        return "正在安装计算节点程序…";
      case "starting":
        return "正在启动计算节点…";
      case "running":
        return "正在作为计算节点运行";
      case "training":
        return "正在训练";
      case "suspended":
        return "你的账户已停用";
      case "removed":
        return "已从工作台的计算节点中移除";
      case "failed":
        return `未能作为计算节点运行：${brief(phase.detail)}`;
    }
  },
  noWorkbench: "尚未连接工作台",
  serve: "让这台电脑作为计算节点",
  open: "打开 SeedBuddy",
  changeWorkbench: "更换工作台…",
  download: (version) => `下载 SeedBuddy ${version}…`,
  quit: "退出 SeedBuddy",
  connectHeading: "连接工作台",
  connectHint: "输入你的 SeedBuddy 工作台地址。",
  connect: "连接",
  refused: (address) => `在 ${address} 没有找到 SeedBuddy 工作台`,
  leaveHeading: "要离开此页面吗？",
  leaveDetail: "你所做的更改可能不会保存。",
  leave: "离开",
  stay: "留下",
};

/** The app's words in the language the system is set to. */
export function messages(locale: string): Messages {
  return locale.toLowerCase().startsWith("zh") ? zh : en;
}
