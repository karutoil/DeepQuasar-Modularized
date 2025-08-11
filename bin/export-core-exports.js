// This script scans all JS files in the core directory and exports all functions, constants, classes, and defaults to a Markdown file in docs.

import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const coreDir = path.join(__dirname, '../core');
const docsDir = path.join(__dirname, '../docs');
const outputFile = path.join(docsDir, 'core-exports.md');

function getExportsFromFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const exports = [];
    // Match named exports
    const namedExportRegex = /export\s+(const|let|var|function|class)\s+([a-zA-Z0-9_]+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
        exports.push({ type: match[1], name: match[2] });
    }
    // Match default exports
    const defaultExportRegex = /export\s+default\s+([a-zA-Z0-9_]+)/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
        exports.push({ type: 'default', name: match[1] });
    }
    // Match module.exports assignments (CommonJS)
    const moduleExportsRegex = /module\.exports\s*=\s*({[\s\S]*?})/g;
    while ((match = moduleExportsRegex.exec(content)) !== null) {
        exports.push({ type: 'module.exports', name: match[1] });
    }
    // Match exports.X = ...
    const exportsAssignmentRegex = /exports\.([a-zA-Z0-9_]+)\s*=\s*/g;
    while ((match = exportsAssignmentRegex.exec(content)) !== null) {
        exports.push({ type: 'exports', name: match[1] });
    }
    return exports;
}

function scanCoreExports() {
    const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.js'));
    let md = '# Core Exports\n\n';
    let examplesMd = '# Core Exports Usage Examples\n\n';
    files.forEach(file => {
        const filePath = path.join(coreDir, file);
        const exports = getExportsFromFile(filePath);
        if (exports.length > 0) {
            md += `## ${file}\n`;
            examplesMd += `## ${file}\n`;
            exports.forEach(exp => {
                md += `- **${exp.type}**: \`${exp.name}\`\n`;
                // Example usage snippet
                let example = '';
                if (exp.type === 'function') {
                    example = `import { ${exp.name} } from '../core/${file}';\n\n${exp.name}(/* args */);`;
                } else if (exp.type === 'class') {
                    example = `import { ${exp.name} } from '../core/${file}';\n\nconst instance = new ${exp.name}();`;
                } else if (exp.type === 'const' || exp.type === 'let' || exp.type === 'var') {
                    example = `import { ${exp.name} } from '../core/${file}';\n\nconsole.log(${exp.name});`;
                } else if (exp.type === 'default') {
                    example = `import ${exp.name} from '../core/${file}';\n\n// Use ${exp.name}`;
                } else if (exp.type === 'exports' || exp.type === 'module.exports') {
                    example = `const { ${exp.name} } = require('../core/${file}');\n\n// Use ${exp.name}`;
                }
                if (example) {
                    examplesMd += `### ${exp.name}\n\n\n\`\`\`js\n${example}\n\`\`\`\n\n`;
                }
            });
            md += '\n';
        }
    });
    // Scan commands subfolder
    const commandsDir = path.join(coreDir, 'commands');
    if (fs.existsSync(commandsDir)) {
        const cmdFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
        cmdFiles.forEach(file => {
            const filePath = path.join(commandsDir, file);
            const exports = getExportsFromFile(filePath);
            if (exports.length > 0) {
                md += `## commands/${file}\n`;
                examplesMd += `## commands/${file}\n`;
                exports.forEach(exp => {
                    md += `- **${exp.type}**: \`${exp.name}\`\n`;
                    // Example usage snippet
                    let example = '';
                    if (exp.type === 'function') {
                        example = `import { ${exp.name} } from '../core/commands/${file}';\n\n${exp.name}(/* args */);`;
                    } else if (exp.type === 'class') {
                        example = `import { ${exp.name} } from '../core/commands/${file}';\n\nconst instance = new ${exp.name}();`;
                    } else if (exp.type === 'const' || exp.type === 'let' || exp.type === 'var') {
                        example = `import { ${exp.name} } from '../core/commands/${file}';\n\nconsole.log(${exp.name});`;
                    } else if (exp.type === 'default') {
                        example = `import ${exp.name} from '../core/commands/${file}';\n\n// Use ${exp.name}`;
                    } else if (exp.type === 'exports' || exp.type === 'module.exports') {
                        example = `const { ${exp.name} } = require('../core/commands/${file}');\n\n// Use ${exp.name}`;
                    }
                    if (example) {
                        examplesMd += `### ${exp.name}\n\n\`\`\`js\n${example}\n\`\`\`\n\n`;
                    }
                });
                md += '\n';
            }
        });
    }
    fs.writeFileSync(outputFile, md);
    fs.writeFileSync(path.join(docsDir, 'core-exports-examples.md'), examplesMd);
    console.log(`Exported core exports to ${outputFile}`);
    console.log(`Exported core usage examples to ${path.join(docsDir, 'core-exports-examples.md')}`);
}

scanCoreExports();
