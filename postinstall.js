const fs = require("fs");
const { execSync } = require("child_process");

if (!fs.existsSync(__dirname + "/dist")) {
    try {
        execSync("tsc");
    } catch (e) {
        console.warn(
            "WARN: Cannot compile the source code, make sure you have " +
            "typescript installed and run 'npm rebuild microse' manually"
        );
    }
}
