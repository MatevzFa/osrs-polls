# Readme

## Setup

### Archive's db-params.json
This is how the JSON should look like. It must be placed in the root directory.
```json
{
    "host": "myserver",
    "port": "1234",
    "user": "john",
    "password": "password",
    "database": "my-database"
}
```

### Database model

You can find a MySql Workbench EER model for the database [here](database/osrs-polls-eer.mwb).

## Usage

### Website

By default, [app.js](app.js) runs on port 8080. If you are running the web server locally, you can access the website on `localhost:8080`.

### Archive

The [archive](archive.js) connects to the database specified in [db-params.json](#archives-db-paramsjson). Every `INTERVAL` minutes (relative to XXh 00m 00s), it will pull data from the poll that is currently live, and save the data into the database.