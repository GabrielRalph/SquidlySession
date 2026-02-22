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
        .map(b => {
            let res = {branch: b, name: b.replace(/^origin\//, ''), valid: false};
            // let name = b.replace(/^origin\//, '');
            if (!(b.length > 0 && !b.includes('->'))) {
                 // Get the latest commit SHA for the branch
                const commitSha = execSync(`git rev-parse ${b}`, { encoding: 'utf-8' }).trim();
                res.commitSha = commitSha;
                res.valid = true;
            }
            return res;
        // Exclude symbolic refs
        }).filter(b => !b.valid);

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

    

   

    const branches = getBranches();


     // Retrieve cache file
    const cacheFile = path.join(buildDir, 'build-cache.json');
    let buildCache = {};
    if (fs.existsSync(cacheFile)) {
        buildCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }

    const branchesToUpdate = branches.filter(({name, commitSha}) => {
        // build if branch has changed since last build or if it doesn't exist in the build directory
        if ( buildCache[name] !== commitSha || !fs.existsSync(path.join(buildDir, name))) { 
            return true;
        } else {
            console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n~~~~ USING CACHE FOR: '" + name + "' ~~~~\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
            return false;
        }
    });

    const brancheInfo = { }
    for (const {branch, name, commitSha} of branchesToUpdate) {
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
            buildCache[name] = commitSha;
        } catch (error) {
            console.error(`Error processing branch ${branch}:`, error);
        }
    }

    // If it doesn't exist, create the build directory
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
    }


    // If the main branch was built, update the root index.html to point 
    // to the correct script, otherwise leave it alone 
    // (assuming it was already set up correctly in a previous build).
    const mainBranch = branchesToUpdate.find(b => b.name === 'main' || b.name === 'master');
    if (mainBranch) {
        const queryScript = `<script type = "module">
            const params = new URLSearchParams(window.location.search);
            const branch = params.get('branch') || 'main';
            import('./' + branch + '/${rootScript}');
        </script>`;
    
        let indexHTML = getBranchIndexHTML(brancheInfo[mainBranch.name].tempDir);
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

        // save new index.html to build directory
        fs.writeFileSync(path.join(buildDir, 'index.html'), indexHTML, 'utf-8');
    }

    // Save updated cache file
    fs.writeFileSync(cacheFile, JSON.stringify(buildCache, null, 2), 'utf-8');

    // For each branch that was built
    for (const [branch, {src}] of Object.entries(brancheInfo)) {
        const destDir = path.join(buildDir, branch);
        if (fs.existsSync(destDir)) {
            fs.rmSync(destDir, { recursive: true, force: true });
        } 
        fs.mkdirSync(destDir, { recursive: true });
        fs.renameSync(src, destDir);
    }

    // Completely remove temp directory after processing all branches
    fs.rmSync(tempDir, { recursive: true, force: true });

     // Clean up any stale git worktree records from previous script runs
    try {
        execSync('git worktree prune', { stdio: 'ignore' });
    } catch (e) { }
}


buildBranches('public');