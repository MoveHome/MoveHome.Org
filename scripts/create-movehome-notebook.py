#!/usr/bin/env python3
import os
import sys
import json
import subprocess

PROFILE = "estateaigents"
NOTEBOOK_NAME = "MoveHome.org Launch & B2C Strategy"
SCRIPT_PATH = "/root/projects/movehome/src/app/about/explainer-script.md"

def run_cmd(args):
    try:
        res = subprocess.run(args, capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Command failed: {' '.join(args)}")
        print(f"Error output: {e.stderr.strip()}")
        return None

def main():
    print("==================================================")
    print("🚀 MoveHome.org NotebookLM Automation Sync Script")
    print("==================================================\n")

    # Step 1: Pre-flight check on profile authentication
    print("Step 1: Checking authentication status for 'estateaigents' profile...")
    list_res = run_cmd(["notebooklm", "--profile", PROFILE, "list", "--json"])
    
    if not list_res:
        print("\n❌ AUTHENTICATION ERROR:")
        print("Your Google cookies for the 'estateaigents' profile have expired or are missing.")
        print("Please open your Chrome browser, ensure you are logged into notebooklm.google.com,")
        print("and click '🔄 Sync Cookies Now' on your 'Esoteric NBML Sync' Chrome extension.")
        print("Once the success message appears, re-run this script.")
        sys.exit(1)
        
    try:
        notebooks = json.loads(list_res)
    except Exception:
        notebooks = []

    # Step 2: Check if notebook already exists
    notebook_id = None
    if isinstance(notebooks, list):
        for nb in notebooks:
            if nb.get("title") == NOTEBOOK_NAME:
                notebook_id = nb.get("id")
                print(f"Step 2: Found existing notebook '{NOTEBOOK_NAME}' with ID: {notebook_id}")
                break

    # Step 3: Create notebook if it does not exist
    if not notebook_id:
        print(f"Step 2: Creating brand-new notebook '{NOTEBOOK_NAME}'...")
        create_res = run_cmd(["notebooklm", "--profile", PROFILE, "create", NOTEBOOK_NAME, "--json"])
        if not create_res:
            print("❌ Failed to create notebook. Aborting.")
            sys.exit(1)
        try:
            nb_data = json.loads(create_res)
            notebook_id = nb_data.get("id")
            print(f"✅ Created successfully! Notebook ID: {notebook_id}")
        except Exception:
            print("❌ Failed to parse notebook creation response. Aborting.")
            sys.exit(1)

    # Step 4: Upload the explainer script file
    print(f"\nStep 4: Uploading explainer script source: {SCRIPT_PATH}")
    if not os.path.exists(SCRIPT_PATH):
        print(f"❌ Source file not found at: {SCRIPT_PATH}")
        sys.exit(1)

    # Positional argument (file path) must go last in Click CLI
    upload_args = [
        "notebooklm", 
        "--profile", PROFILE, 
        "source", "add", 
        "-n", notebook_id, 
        "--type", "file", 
        SCRIPT_PATH
    ]
    
    upload_res = run_cmd(upload_args)
    if upload_res:
        print("✅ Explainer script uploaded successfully to NotebookLM! 🚀")
        print("\n==================================================")
        print("🎉 SUCCESSFUL COMPLETION!")
        print("==================================================")
        print(f"Your notebook '{NOTEBOOK_NAME}' is ready.")
        print(f"Notebook ID: {notebook_id}")
        print("\nYou can now generate your audio explainer or video:")
        print(f"  notebooklm --profile estateaigents generate audio --notebook {notebook_id} \"Focus on the layman-friendly explainer script of MoveHome.org\"")
        print("==================================================")
    else:
        print("❌ Upload failed. Please check files and permissions.")

if __name__ == "__main__":
    main()
