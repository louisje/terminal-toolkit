import stringWidth from "string-width";
import { VERSION } from "../utils/version.js";
import { getToolNames } from "../tools/definitions.js";
// Use named ANSI palette codes rather than 24-bit RGB so the terminal's
// own theme adjusts each color for the user's background. Pure RGB colors
// like #ffffff (white) are invisible on light terminals; named ANSI white
// is rendered as black-or-similar by light themes.
const BRAND_COLOR = "\x1b[36m"; // cyan
const PINK_COLOR = "\x1b[35m"; // magenta
const YELLOW_COLOR = "\x1b[33m"; // yellow (rendered as orange-ish on light themes)
const WHITE_COLOR = "\x1b[39m"; // default foreground (theme-appropriate)
const GREEN_COLOR = "\x1b[32m"; // green
const RESET = "\x1b[0m";
// ANSI Shadow style figlet logo for "TERMINAL" + "MCP" stacked
const LOGO = `
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝
                    ███╗   ███╗ ██████╗██████╗
                    ████╗ ████║██╔════╝██╔══██╗
                    ██╔████╔██║██║     ██████╔╝
                    ██║╚██╔╝██║██║     ██╔═══╝
                    ██║ ╚═╝ ██║╚██████╗██║
                    ╚═╝     ╚═╝ ╚═════╝╚═╝
`.trim();
/**
 * Generate the startup banner string
 */
export function getBanner(options) {
    // Build the logo with box around it
    const logoLines = LOGO.split("\n");
    // Find the widest logo line to determine box width (using visual width)
    const maxLogoWidth = Math.max(...logoLines.map((l) => stringWidth(l)));
    const boxWidth = maxLogoWidth + 4; // 2 chars padding on each side
    const horizontalLine = "─".repeat(boxWidth);
    // Center the logo as a block (same left padding for all lines)
    // First 6 lines are TERMINAL (blue), last 6 lines are MCP (pink)
    const centeredLogo = logoLines.map((line, index) => {
        const rightPad = boxWidth - 2 - stringWidth(line);
        const color = index < 6 ? BRAND_COLOR : PINK_COLOR;
        return YELLOW_COLOR + "│ " + color + line + " ".repeat(Math.max(0, rightPad)) + " " + YELLOW_COLOR + "│";
    });
    // Helper: build a box content line with correct padding.
    // `content` is the visible text (no ANSI) to place between │…│.
    // `styled` is the same text but with ANSI color codes included.
    const boxLine = (content, styled) => {
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
      "command": "terminal-mcp"
    }
  }
}`;
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

${mcpConfig}

${YELLOW_COLOR}╭${horizontalLine}╮
${boxLine(restartContent, restartStyled)}
${YELLOW_COLOR}╰${horizontalLine}╯${RESET}
`;
}
/**
 * Pad a string to the right with spaces (using visual width)
 */
function padRight(str, length) {
    const width = stringWidth(str);
    if (width >= length) {
        return str.substring(0, length - 1) + " ";
    }
    return str + " ".repeat(length - width);
}
//# sourceMappingURL=index.js.map