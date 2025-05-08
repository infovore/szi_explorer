<script lang="ts">
  import { ZipReader, type FileEntry } from '$lib/zip_reader';
  import { filesize } from 'filesize';

  let urlInputElement: HTMLInputElement;

  let sziUrl = $state('');
  let entries = $state([] as FileEntry[]);
  let fileSize = $state(0);
  let reader = $state(undefined as ZipReader | undefined);

  let previewSrc = $state('');
  let previewText = $state('');

  const getSzi = async (e: Event) => {
    e.preventDefault();

    entries = [];
    reader = undefined;
    fileSize = 0;
    previewSrc = '';
    previewText = '';
    sziUrl = urlInputElement.value;

    reader = new ZipReader(sziUrl);
    fileSize = await reader.getFileSize();
    entries = await reader.readTableOfContents();
  };

  const showImage = async (entry: FileEntry) => {
    if (!reader) {
      return;
    }

    const blob = await reader.extractFile(entry);
    const url = URL.createObjectURL(blob);

    previewSrc = url;
    previewText = `${entry.fileName} (${filesize(entry.compressedSize)}) - Offset: ${entry.dataOffset}`;
  };

  const logContents = async (entry: FileEntry) => {
    if (!reader) {
      return;
    }

    const blob = await reader.extractFile(entry);
    const text = await blob.text();
    console.log(text);
  };
</script>

<div class="relative mt-4">
  <h1 class="mb-4 text-4xl font-bold">SZI Explorer</h1>

  <div class="sticky top-0 mb-4 flex gap-2 bg-white pb-2">
    <div class="flex-2/3 rounded-xl bg-slate-200 p-4">
      <form>
        <label for="url" class="font-bold">SZI URL</label>
        <div class="my-2 flex gap-2">
          <input type="text" name="url" class="mr-1 flex-1 rounded" bind:this={urlInputElement} />
          <button
            onclick={getSzi}
            class="flex-initial rounded-lg bg-blue-600 px-4 py-2 text-white hover:cursor-pointer"
            >Read file</button
          >
        </div>
        <div>
          The file should be an SZI (uncompressed ZIP containing a DZI image). Any file extension is
          OK. Any compression is <em>not</em> OK! The URL should serve up a correct
          <code>content-length</code>
          header when a <code>HEAD</code> request is made.
        </div>
      </form>
    </div>
    <div class="flex-1/3">
      {#if previewSrc != ''}
        <img src={previewSrc} class="block w-full" />
        <div class="font-xs font-mono">{previewText}</div>
      {/if}
    </div>
  </div>

  <div>
    {#if sziUrl != '' && fileSize > 0}
      <h3 class="mb-2 text-xl"><span class="font-bold">{sziUrl}</span> ({filesize(fileSize)})</h3>
    {/if}
    {#if entries && entries.length > 0}
      <table class="w-full table-auto">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Data Offset</th>
            <th>Type</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each entries as entry}
            <tr>
              <td>{entry.fileName}</td>
              <td>{filesize(entry.uncompressedSize)}</td>
              <td>{entry.dataOffset}</td>
              <td>
                {#if entry.isDirectory}
                  Directory
                {:else}
                  File
                {/if}
              </td>
              <td>
                {#if entry.isImage}
                  <button
                    class="rounded border border-slate-400 bg-slate-100 p-2 hover:cursor-pointer"
                    onclick={(e) => {
                      e.preventDefault();
                      showImage(entry);
                    }}>Show Image</button
                  >
                {:else if !entry.isDirectory}
                  <button
                    class="rounded border border-slate-400 bg-slate-100 p-2 hover:cursor-pointer"
                    onclick={(e) => {
                      e.preventDefault();
                      logContents(entry);
                    }}>Log Contents</button
                  >
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style lang="postcss">
  @reference "../app.css";

  table {
    thead {
      th {
        @apply font-bold;
        @apply px-2;
        @apply py-1;
        @apply border-b;
        @apply border-b-slate-200;
        @apply text-left;
      }
    }
    tbody {
      td {
        @apply px-2;
        @apply py-1;
      }
    }
  }
</style>
