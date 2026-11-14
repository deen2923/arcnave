"""Uploads deploy/out/hf-space (made by deploy/hf/pack-hf.ps1) to a Hugging Face Docker Space.

  pip install -U huggingface_hub
  hf auth login                       (paste a token with "write" access from huggingface.co/settings/tokens)
  python deploy/hf/upload-hf.py <your-hf-name>/arcnave

The upload resumes where it stopped if it is cut off (run the same command again). Files already on the Space are
skipped, so after a code change only the changed files go up. The Space rebuilds and restarts by itself afterwards.
"""
import os
import sys

from huggingface_hub import HfApi

if len(sys.argv) != 2 or "/" not in sys.argv[1]:
    sys.exit("Usage: python deploy/hf/upload-hf.py <your-hf-name>/<space-name>")
repo = sys.argv[1]
folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "out", "hf-space")
folder = os.path.normpath(folder)
if not os.path.isfile(os.path.join(folder, "Dockerfile")):
    sys.exit(f"No {folder}\\Dockerfile: run deploy\\hf\\pack-hf.ps1 first")

api = HfApi()
print(f"Signed in as {api.whoami()['name']}. Uploading {folder} to the Space {repo}...")
api.create_repo(repo, repo_type="space", space_sdk="docker", exist_ok=True)
api.upload_large_folder(repo_id=repo, repo_type="space", folder_path=folder)
owner, name = repo.split("/", 1)
print(f"Done. The Space builds now (a few minutes): https://huggingface.co/spaces/{repo}")
print(f"Its address: https://{owner.lower()}-{name.lower().replace('_', '-')}.hf.space")
