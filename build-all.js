import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';


function getBranches() {
    // Get all remote branches
    const branchesOutput = execSync('git branch -r', { encoding: 'utf-8' });
    
    // Filter and clean branch names
    const branches = branchesOutput
        .split('\n')
        .map(b => b.trim())
        .filter(b => b.length > 0 && !b.includes('->')) // Exclude symbolic refs
        .map(b => [b, b.replace('origin/', '')]); // Remove 'origin/' prefix

    return branches;
}


function downloadBranch(branch, dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // Use git worktree to checkout the branch into the target directory
    // --detach ensures we just check out the commit without creating local tracking branches
    execSync(`git worktree add --detach "${dir}" "${branch}"`, { stdio: 'inherit' });

     // Initialize and update submodules inside the new worktree
    console.log(`Updating submodules for ${branch}...`);
    execSync(`git submodule update --init --recursive`, { cwd: dir, stdio: 'inherit' });

     // Remove the .git file created by worktree so it isn't deployed to GitHub Pages
    const gitFilePath = path.join(dir, '.git');
    if (fs.existsSync(gitFilePath)) {
        fs.rmSync(gitFilePath, { recursive: true, force: true });
    }
}

function checkForBuildScript(dir) {
    const pkgJsonPath = path.join(dir, 'package.json');
    const rollupConfigPath = path.join(dir, 'rollup.config.js');
    return (fs.existsSync(pkgJsonPath) && fs.existsSync(rollupConfigPath))
}

function checkForSrcDir(dir) {
    const srcDirPath = path.join(dir, 'src');
    return fs.existsSync(srcDirPath) && fs.lstatSync(srcDirPath).isDirectory();
}

function buildBranch(dir) {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
        console.log(`Installing dependencies...`);
        execSync('npm install', { cwd: dir, stdio: 'inherit' });

        console.log(`Building project...`);
        execSync('npm run build', { cwd: dir, stdio: 'inherit' });

        console.log(`Cleaning up build files...`);
        fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
        fs.rmSync(path.join(dir, 'package-lock.json'), { force: true });
        fs.rmSync(pkgJsonPath, { force: true });
    } else {
        console.log(`No package.json found. Skipping npm install and build.`);
    }
}

function getBranchIndexHTML(dir) {
    const indexPath = path.join(dir, 'index.html');
    let html = null;
    if (fs.existsSync(indexPath)) {
        html = fs.readFileSync(indexPath, 'utf-8');
    }
    return html;
}



function buildBranches(buildDir, rootScript = "index.js", tempDir = "temp") {
    // Clean up any stale git worktree records from previous script runs
    try {
        execSync('git worktree prune', { stdio: 'ignore' });
    } catch (e) { }

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const brancheInfo = {

    }

    const branches = getBranches();
    for (const [branch, name] of branches) {
        try {

            const branchDir = path.join(tempDir, name);

            console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n~~~~ DOWNLOADING BRANCH: '" + branch + "' ~~~~\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            downloadBranch(branch, branchDir);
    
            if (checkForSrcDir(branchDir)) {
                let srcCode = path.join(branchDir, 'src');
                if (checkForBuildScript(branchDir)) {
                    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n~~~~ BUILDING BRANCH: '" + branch + "' ~~~~\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
                    buildBranch(branchDir);
                    srcCode = path.join(branchDir, 'build');
                } else {
                    console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n~~~~ NO BUILD SCRIPT IN BRANCH: '" + branch + "' ~~~~\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
                }
                brancheInfo[name] = {
                    src: srcCode,
                    tempDir: branchDir,
                }
            } else {
                console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n~~~~ NO SRC IN BRANCH: '" + branch + "' ~~~~\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            }
        } catch (error) {
            console.error(`Error processing branch ${branch}:`, error);
        }
    }

    const queryScript = `<script type = "module">
        const params = new URLSearchParams(window.location.search);
        const branch = params.get('branch') || 'main';
        import('./' + branch + '/${rootScript}');
    </script>`;

    let indexHTML = getBranchIndexHTML(tempDir);
    if (!indexHTML) {
        indexHTML = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Branch Viewer</title>
            ${queryScript}
        </head>
        <body>
        </body>
        </html>`;
    } else {
        const scirptRegex = `<script\\s+(type\\s*=\\s*("module"|module)\\s*)?src\\s*=\\s*"\\.\\/(build|src)\\/${rootScript}"\\s*(type\\s*=\\s*"module"\\s*)?>\\s*<\\/\\s*script>`;
        indexHTML = indexHTML.replace(new RegExp(scirptRegex, 'i'), queryScript);
    }


    
    if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
    }
     fs.mkdirSync(buildDir, { recursive: true });

    fs.writeFileSync(path.join(buildDir, 'index.html'), indexHTML, 'utf-8');

    for (const [branch, {src, tempDir}] of Object.entries(brancheInfo)) {
        const destDir = path.join(buildDir, branch);
        fs.mkdirSync(destDir, { recursive: true });
        fs.renameSync(src, destDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
}


buildBranches('public');