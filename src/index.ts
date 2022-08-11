import "dotenv/config";
import { google, youtube_v3 } from "googleapis";

const sourcePlaylistIds: string[] = JSON.parse(
  process.env.SOURCE_PLAYLIST_IDS ?? "[]"
);

const targetPlaylistId = process.env.TARGET_PLAYLIST_ID as string;

if (!targetPlaylistId) {
  throw new Error("Target Playlist ID not set");
}

if (!sourcePlaylistIds || sourcePlaylistIds?.length === 0) {
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

  //doesn't work, I get forbidden playlistItemsNotAccessible
  // if (process.env.REMOVE_DELETED_VIDEOS_FROM_PLAYLIST) {
  //   for (const item of items) {
  //     if (item.snippet?.title === "Deleted video" && item.id) {
  //       await deleteVideoFromPlaylist(item.id);
  //     }
  //   }
  // }

  return items;
}

async function deleteVideoFromPlaylist(playlistItemId: string) {
  //not using this any more coz appaz i can't remove a deleted video! it gives forbidden: playlistItemsNotAccessible
  return youtube.playlistItems.delete({
    id: playlistItemId,
  });
}

async function getNextPageInPlaylist(playlistId: string, pageToken?: string) {
  return youtube.playlistItems
    .list({
      playlistId,
      pageToken: pageToken,
      maxResults: PLAYLIST_PAGE_SIZE,
      part: ["contentDetails", "status", "snippet"],
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
      if (item.id && isVideoAvailable(item.snippet?.title))
        await youtube.playlistItems.delete({ id: item.id });
    }
  } //needs to be in order, can't do all in parallel, or scanneditems won't be right
}

async function addSourcePlaylistToTargetPlaylist(
  sourcePlaylistId: string,
  targetPlaylistId: string
) {
  const sourcePlaylistItems = await getAllVideosInPlaylist(sourcePlaylistId);
  const targetPlaylistItems = await getAllVideosInPlaylist(targetPlaylistId); //get it here again in case there are duplicates, because there might be duplicates across different source playlists.

  for (const sourceItem of sourcePlaylistItems) {
    if (
      !targetPlaylistItems
        .map((el) => el.contentDetails?.videoId)
        .includes(sourceItem.contentDetails?.videoId) &&
      sourceItem.contentDetails?.videoId &&
      isVideoAvailable(sourceItem.snippet?.title) //otherwise error
    ) {
      await addVideoToPlaylist(
        sourceItem.contentDetails.videoId,
        targetPlaylistId
      );
    }
  }
}

async function addVideoToPlaylist(videoId: string, playlistId: string) {
  return youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: { videoId, kind: "youtube#video" },
      },
    },
  });
}

async function run() {
  let playlistItems = await getAllVideosInPlaylist(targetPlaylistId);
  console.log("num vids in playlist before: ", playlistItems.length);
  console.log(playlistItems.map((el) => el.contentDetails?.videoId));

  await makePlaylistUnique(playlistItems);

  for (const sourcePlaylistId of sourcePlaylistIds) {
    await addSourcePlaylistToTargetPlaylist(sourcePlaylistId, targetPlaylistId);
  }

  let playlistItemsAfter = await getAllVideosInPlaylist(targetPlaylistId);

  console.log("num vids in playlist after:", playlistItemsAfter.length);
  console.log(playlistItemsAfter.map((el) => el.contentDetails?.videoId));
}

function isVideoAvailable(videoTitle?: string | null) {
  return videoTitle !== "Private video" && videoTitle !== "Deleted video";
}

run();

//NOTE: it fails with some "precondition check failed" error if there is a deleted video or private video in any playlist. We need to account for this case.
