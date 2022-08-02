import "dotenv/config";
import { google, youtube_v3 } from "googleapis";

const sourcePlaylists: string[] = JSON.parse(
  process.env.SOURCE_PLAYLIST_IDS ?? "[]"
);

const targetPlaylistId = process.env.TARGET_PLAYLIST_ID as string;

if (!targetPlaylistId) {
  throw new Error("Target Playlist ID not set");
}

if (!sourcePlaylists || sourcePlaylists?.length === 0) {
  console.warn(
    "No source playlists! All that will happen is the target playlist will be made unique"
  );
}

const auth = new google.auth.OAuth2({
  clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID,
  clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
});

auth.setCredentials({
  refresh_token: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
});

const youtube = google.youtube({
  version: "v3",
  auth,
});

const PLAYLIST_PAGE_SIZE = 50;

async function getAllVideosInPlaylist(playlistId: string) {
  let items: youtube_v3.Schema$PlaylistItem[] = [];
  const firstPage = await getNextPageInPlaylist(playlistId);
  let nextPageToken = firstPage.nextPageToken;
  items = [...items, ...(firstPage.items ?? [])];

  while (nextPageToken) {
    const nextPage = await getNextPageInPlaylist(playlistId, nextPageToken);
    items = [...items, ...(nextPage.items ?? [])];
    nextPageToken = nextPage.nextPageToken;
  }

  return items;
}

async function getNextPageInPlaylist(playlistId: string, pageToken?: string) {
  return youtube.playlistItems
    .list({
      playlistId,
      pageToken: pageToken,
      maxResults: PLAYLIST_PAGE_SIZE,
      part: ["contentDetails"],
    })
    .then((res) => {
      return res.data;
    });
}

async function makePlaylistUnique(
  playlistItems: youtube_v3.Schema$PlaylistItem[]
) {
  let scannedItems: youtube_v3.Schema$PlaylistItem[] = [];

  for (const item of playlistItems) {
    if (
      !scannedItems
        .map((el) => el.contentDetails?.videoId)
        .includes(item.contentDetails?.videoId)
    ) {
      scannedItems.push(item);
    } else {
      if (item.id) await youtube.playlistItems.delete({ id: item.id });
    }
  } //needs to be in order, can't do all in parallel, or scanneditems won't be right
}

async function run() {
  let playlistItems = await getAllVideosInPlaylist(targetPlaylistId);
  console.log("num vids in playlist: ", playlistItems.length);
  console.log(playlistItems.map((el) => el.contentDetails?.videoId));

  await makePlaylistUnique(playlistItems);

  let playlistItemsUnique = await getAllVideosInPlaylist(targetPlaylistId);

  console.log(
    "num unique in playlistItemsUnique: ",
    playlistItemsUnique.length
  );
  console.log(playlistItemsUnique.map((el) => el.contentDetails?.videoId));
}

run();
