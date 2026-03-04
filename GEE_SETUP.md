# Setting up Google Earth Engine (GEE) Service Account

To use Google Earth Engine with a backend service (like the one we are building), you need a **Service Account**. Here is how to create one and get the credentials JSON file.

## Prerequisites
- A Google Cloud Platform (GCP) Project.
- The Google Earth Engine API enabled for that project.
- Your Google account must be registered for Earth Engine access (https://signup.earthengine.google.com/).

## Step-by-Step Guide

### 1. Create a Service Account
1.  Go to the **Google Cloud Console**: [https://console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2.  Select your project.
3.  Click **+ CREATE SERVICE ACCOUNT**.
4.  **Service account details**:
    - Name: e.g., `gee-backend-sa`
    - ID: (auto-generated)
    - Description: "Service account for CSVAT backend"
    - Click **CREATE AND CONTINUE**.
5.  **Grant this service account access to project**:
    - Role: Select **Earth Engine Resource Writer** (or Editor/Viewer depending on needs, but often "Editor" is easiest for development). If you don't see Earth Engine roles, you might need to enable the API first.
    - Click **CONTINUE**.
6.  **Grant users access to this service account**:
    - (Optional) Leave blank.
    - Click **DONE**.

### 2. Generate a Key (JSON file)
1.  In the list of service accounts, find the one you just created.
2.  Click the **three dots (Actions)** on the right side and select **Manage keys**.
3.  Click **ADD KEY** > **Create new key**.
4.  Key type: **JSON**.
5.  Click **CREATE**.
6.  A JSON file will be downloaded to your computer. **This is your credential file.**
    - Keep this file secure! It provides access to your GEE resources.

### 3. Register the Service Account in Earth Engine
1.  Note the email address of the service account you created (e.g., `gee-backend-sa@your-project.iam.gserviceaccount.com`).
2.  Go to the **Earth Engine Code Editor**: [https://code.earthengine.google.com/](https://code.earthengine.google.com/)
3.  Click the **Assets** tab on the left.
4.  Click the **Share** button next to your home folder (or any specific asset folder you want the app to access/write to).
5.  Enter the service account email address in the "Add users or groups" field.
6.  Select **Can write** (or Can read) as the permission level.
7.  Click **Add**.

## Usage in Project
Once you have the JSON file:
1.  Rename it to something simple, like `gee-service-account.json`.
2.  Place it in the root or a `config` folder of your project (make sure to adding it to `.gitignore` so you don't commit secrets!).
3.  We will reference its path in our backend configuration.
