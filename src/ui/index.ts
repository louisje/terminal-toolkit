import stringWidth from "string-width";
import { VERSION } from "../utils/version.js";
import { getToolNames } from "../tools/definitions.js";

// Use named ANSI palette codes rather than 24-bit RGB so the terminal's
// own theme adjusts each color for the user's background. Pure RGB colors
// like #ffffff (white) are invisible on light terminals; named ANSI white
// is rendered as black-or-similar by light themes.
const BRAND_COLOR = "\x1b[36m";   // cyan
const PINK_COLOR = "\x1b[35m";    // magenta
const YELLOW_COLOR = "\x1b[33m";  // yellow (rendered as orange-ish on light themes)
const WHITE_COLOR = "\x1b[39m";   // default foreground (theme-appropriate)
const GREEN_COLOR = "\x1b[32m";   // green
// One Dark Pro-inspired JSON palette (24-bit ANSI).
const CODE_BG = "\x1b[48;2;65;70;80m";       // #414650, lighter slate gray
const CODE_TEXT = "\x1b[38;2;171;178;191m"; // #ABB2BF punctuation
const CODE_KEY = "\x1b[38;2;224;108;117m";  // #E06C75 property names
const CODE_VALUE = "\x1b[38;2;152;195;121m";// #98C379 string values
const RESET = "\x1b[0m";

// ANSI Shadow-style block logo for TERMINAL + TOOLKIT
const LOGO = `
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝
████████╗ ██████╗  ██████╗ ██╗     ██╗  ██╗██╗████████╗
╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██║ ██╔╝██║╚══██╔══╝
   ██║   ██║   ██║██║   ██║██║     █████╔╝ ██║   ██║
   ██║   ██║   ██║██║   ██║██║     ██╔═██╗ ██║   ██║
   ██║   ╚██████╔╝╚██████╔╝███████╗██║  ██╗██║   ██║
   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝   ╚═╝
`.trim();

export interface BannerOptions {
  socketPath: string;
  cols: number;
  rows: number;
  shell: string;
  sandboxEnabled?: boolean;
}

/**
 * Generate the startup banner string
 */
export function getBanner(options: BannerOptions): string {
  // Build the logo with box around it
  const logoLines = LOGO.split("\n");

  // The full frame is 79 columns, including its two border characters.
  const frameWidth = 79;
  const boxWidth = frameWidth - 2;
  const maxLogoWidth = Math.max(...logoLines.map((line) => stringWidth(line)));

  const horizontalLine = "─".repeat(boxWidth);

  // Center each six-line word as a unit, preserving its internal letter spacing.
  // TERMINAL is cyan; TOOLKIT is magenta.
  const centeredLogo = logoLines.map((line, index) => {
    const group = index < 6 ? logoLines.slice(0, 6) : logoLines.slice(6);
    const groupWidth = Math.max(...group.map((part) => stringWidth(part)));
    const leftPad = Math.floor((boxWidth - groupWidth) / 2);
    const rightPad = boxWidth - groupWidth - leftPad;
    const color = index < 6 ? BRAND_COLOR : PINK_COLOR;
    return YELLOW_COLOR + "│" + " ".repeat(leftPad) + color
      + line + " ".repeat(Math.max(0, groupWidth - stringWidth(line)))
      + " ".repeat(rightPad) + YELLOW_COLOR + "│";
  });

  // Helper: build a box content line with correct padding.
  // `content` is the visible text (no ANSI) to place between │…│.
  // `styled` is the same text but with ANSI color codes included.
  const boxLine = (content: string, styled?: string): string => {
    const pad = boxWidth - stringWidth(content);
    return `${YELLOW_COLOR}│${styled ?? content}${" ".repeat(Math.max(0, pad))}${YELLOW_COLOR}│`;
  };

  // Generate tool lines - first line has "Tools:" label, rest are indented
  const toolNames = getToolNames();
  const toolLines = toolNames.map((tool, index) => {
    const prefix = index === 0 ? "  Tools: " : "         ";
    const bullet = "• ";
    const content = `${prefix}${bullet}${tool}`;
    const styled = `${WHITE_COLOR}${content}`;
    return boxLine(content, styled);
  });

  const mcpConfig = `{
  "mcpServers": {
    "terminal": {
      "command": "terminal-toolkit",
      "args": ["--mcp"]
    }
  }
}`;

  // One Dark Pro-inspired JSON syntax highlighting on a full-width code panel.
  // Keep an empty shaded row above and below the JSON.
  const configLines = mcpConfig.split("\n");
  const styledMcpConfig = ["", ...configLines, ""].map((line) => {
    const highlighted = line.replace(
      /("(?:[^"\\]|\\.)*")(\s*:)?/g,
      (_match, quoted: string, colon: string | undefined) =>
        colon
          ? CODE_KEY + quoted + CODE_TEXT + colon
          : CODE_VALUE + quoted + CODE_TEXT
    );
    return CODE_BG + CODE_TEXT + "  " + highlighted
      + " ".repeat(Math.max(0, frameWidth - stringWidth(line) - 2)) + RESET;
  }).join("\n");

  // Build info lines using boxLine helper
  const socketContent = `  Socket: ${options.socketPath}`;
  const socketStyled = `${WHITE_COLOR}${socketContent}`;

  const terminalContent = `  Terminal: ${padRight(`${options.cols}x${options.rows}`, 12)}Shell: ${options.shell}`;
  const terminalStyled = `${WHITE_COLOR}${terminalContent}`;

  const sandboxContent = `  Sandbox: ENABLED (restricted filesystem/network)`;
  const sandboxStyled = `${WHITE_COLOR}  Sandbox: ${GREEN_COLOR}ENABLED${WHITE_COLOR} (restricted filesystem/network)`;
  const sandboxLine = options.sandboxEnabled
    ? boxLine(sandboxContent, sandboxStyled) + "\n"
    : "";

  const versionContent = `${" ".repeat(Math.max(0, boxWidth - stringWidth(`v${VERSION}`) - 1))}v${VERSION}`;
  const versionStyled = `${WHITE_COLOR}${versionContent}`;

  const restartContent = `  Restart your MCP client to connect.`;
  const restartStyled = `${WHITE_COLOR}${restartContent}`;

  return `
${YELLOW_COLOR}╭${horizontalLine}╮
${centeredLogo.join("\n")}
${YELLOW_COLOR}├${horizontalLine}┤
${boxLine(socketContent, socketStyled)}
${boxLine(terminalContent, terminalStyled)}
${sandboxLine}${YELLOW_COLOR}├${horizontalLine}┤
${toolLines.join("\n")}
${YELLOW_COLOR}├${horizontalLine}┤
${boxLine(versionContent, versionStyled)}
${YELLOW_COLOR}╰${horizontalLine}╯${RESET}

${WHITE_COLOR}MCP Configuration (add to your MCP client):${RESET}

${styledMcpConfig}

${YELLOW_COLOR}╭${horizontalLine}╮
${boxLine(restartContent, restartStyled)}
${YELLOW_COLOR}╰${horizontalLine}╯${RESET}
`;
}


/**
 * Pad a string to the right with spaces (using visual width)
 */
function padRight(str: string, length: number): string {
  const width = stringWidth(str);
  if (width >= length) {
    return str.substring(0, length - 1) + " ";
  }
  return str + " ".repeat(length - width);
}

