# PlumeNest API

![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)
![Status](https://img.shields.io/badge/status-stable-green.svg)
![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)

## Overview

PlumeNest API is a private, high-performance web service designed to find and provide direct streamable and downloadable links for movies and TV shows. It is built with a robust, modular architecture in Node.js and Express, featuring a lean scraping engine, persistent caching with Redis, and a full user authentication and database synchronization system.

The primary purpose of this API is to serve as a complete backend for a desktop application, providing all the necessary data and user management features for a rich experience.

## Core Features

-   **Fast Provider Search**: Scrapes fmovies.ro to generate a list of all available content candidates for a given title, including posters, years, and types, allowing the client to display a full results page.
-   **Lazy-Loaded Metadata**: Provides a dedicated endpoint to fetch detailed metadata (like plot overviews) on-demand for a specific item.
-   **Robust Stream Fetching**: Utilizes a lean, fast scraping method to extract direct M3U8 stream URLs, subtitles, and necessary headers.
-   **Persistent Caching**: Integrates with Redis to cache all API responses, dramatically reducing response times and protecting against rate-limiting.
-   **Professional Security & User Management**:
    1.  **Global API Key (`X-API-KEY`)**: Protects the entire service from unauthorized client applications.
    2.  **User Authentication (Auth0)**: Manages user login and registration via Auth0 for industry-standard security.
    3.  **Database Integration (Supabase)**: Automatically syncs authenticated users to a persistent Supabase database via a dedicated endpoint.
-   **Modular & Maintainable**: The codebase is organized into logical services and uses external configuration for selectors.
-   **Health & Monitoring**: Includes a public `/health` endpoint to monitor the API's status and its connection to critical dependencies.
-   **API Versioning**: All protected routes are versioned under `/api/v1` to ensure long-term compatibility.

---

## Project Structure

The project is organized into a modular structure for clarity and separation of concerns.

```
/PlumeNestAPI
|-- /config/             # All configuration files
|   |-- index.js         # Loads and exports all config variables
|   |-- logger.js        # Winston logger configuration
|   |-- selectors.json   # CSS selectors for scraping
|
|-- /services/           # Core business logic
|   |-- cache.js         # Redis client initialization
|   |-- database.js      # Supabase client initialization
|   |-- fmovies.js       # Logic for scraping fmovies.ro
|   |-- stream.js        # Core logic for fetching stream/subtitle URLs
|   |-- tmdb.js          # Logic for fetching data from TMDb
|
|-- /utils/              # Small, reusable helper functions
|   |-- playlistParser.js# M3U8 playlist parsing utility
|
|-- .env                 # Environment variables (secrets)
|-- server.js            # Express server and API route definitions
|-- package.json         # Project dependencies and scripts
|-- README.md            # This file
```

---

## Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18.x or higher recommended)
-   An active [Redis](https://redis.io/) instance
-   An [Auth0](https://auth0.com/) account
-   A [Supabase](https://supabase.com/) project
-   A [TMDb](https://www.themoviedb.org/signup) API Key

### Installation & Setup

1.  **Clone the repository and install dependencies:**
    ```bash
    git clone <your-repo-url>
    cd PlumeNestAPI
    npm install
    ```

2.  **Set up the Supabase `users` table:**
    In your Supabase dashboard, create a table named `users` with at least an `id` (primary key), `auth0_user_id` (text, unique), and `created_at` (timestamptz). Enable Row Level Security (RLS) and create policies that allow `anon` users to `INSERT` and `SELECT`.

3.  **Create the `.env` file:**
    Create a `.env` file in the root of the project with the following variables:

    ```env
    # Server Configuration
    PORT=3001

    # External Services
    TMDB_API_KEY=your_tmdb_api_key_here
    REDIS_URL=your_redis_connection_string_here
    SUPABASE_URL=https://your-project-url.supabase.co
    SUPABASE_ANON_KEY=your_long_anon_public_key_here

    # Security
    API_SECRET_KEY=generate_a_long_random_string_for_your_api_key
    AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
    AUTH0_AUDIENCE=https://your-api-identifier.com
    ```

4.  **Run the server:**
    ```bash
    npm start
    ```

---

## API Endpoints & Workflow

The API is designed for a multi-step, client-driven workflow. All protected endpoints are versioned under `/api/v1` and require `X-API-KEY` and `Authorization: Bearer <JWT>` headers.

### Public Endpoints

#### `GET /health`
Checks the health of the API and its dependencies.

### Protected Endpoints (v1)

#### **Step 1 (Post-Login): Sync User Profile**
#### `POST /api/v1/users/sync`
To be called by the client application immediately after a successful user login. It checks if a user profile exists in the database and creates one if it doesn't.
-   **Body:** None.
-   **Success Response (`200 OK` or `201 Created`):**
    ```json
    {
        "status": "synced",
        "user": {
            "id": 1,
            "auth0_user_id": "google-oauth2|..."
        }
    }
    ```

#### **Step 2: Search for Content**
#### `GET /api/v1/search`
Performs a fast scrape to get a list of all matching content.
-   **Query Parameters:**
    -   `title` (string, required): The title to search for.
-   **Success Response (`200 OK`):** An array of search result objects.
    ```json
    [
        {
            "id": "19788",
            "title": "Interstellar",
            "type": "movie",
            "year": "2014",
            "href": "https://fmovies.ro/movie/watch-interstellar-online-19788",
            "posterUrl": "https://f.woowoowoowoo.net/.../poster.jpg"
        }
    ]
    ```

#### **Step 3 (Optional): Get Detailed Metadata**
#### `GET /api/v1/metadata`
Retrieves the detailed plot overview for a specific item selected by the user.
-   **Query Parameters:**
    -   `id` (string, required): The `id` of the item from the `/search` response.
    -   `url` (string, required): The `href` of the item from the `/search` response.

#### **Step 4: Get Stream**
#### `GET /api/v1/stream`
Retrieves the stream sources and subtitles for a specific movie or episode ID.
-   **Query Parameters:**
    -   `id` (string, required): The final ID of the content.
    -   `type` (string, required): The type of content ('movie' or 'tv').

### TV Show Endpoints
-   `GET /api/v1/seasons`
-   `GET /api/v1/episodes`

---

## Future Development

With the core API and user synchronization in place, the service is ready for client integration. The next logical phase is to build out more user-specific features that leverage the Supabase database.

-   **Watch History:** Implement endpoints to log and retrieve a user's viewing history.
-   **Favorites / Watchlist:** Add functionality for users to save content to a personal list.
-   **User Preferences:** Create endpoints to store and retrieve user-specific application settings.
