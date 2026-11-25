(() => {
  const config = window.CHRISTMAS_ALBUM_CONFIG || {};
  if (!config.url || !config.publishableKey || !config.albumId) return;

  const ALBUM_ID = config.albumId;
  const BUCKET = "christmas-album";
  const TABLE = "christmas_album_photos";
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };

  let supabase;
  let modal;
  let activeChannel;
  let currentUser;
  let authSubscription;

  const style = document.createElement("style");
  style.textContent = `
    .shared-album-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:18px;background:rgba(3,7,18,.82);backdrop-filter:blur(10px)}
    .shared-album-card{width:min(760px,100%);max-height:min(88vh,900px);overflow:auto;border:1px solid rgba(255,217,138,.35);border-radius:20px;background:linear-gradient(145deg,#111827,#080d1a);box-shadow:0 24px 80px rgba(0,0,0,.55);color:#fff;padding:22px;font-family:'Noto Serif SC','Playfair Display',serif}
    .shared-album-head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:14px;margin-bottom:14px}
    .shared-album-title{font-size:18px;color:#ffe4a3;letter-spacing:.08em}
    .shared-album-muted{color:rgba(255,255,255,.68);font-size:13px;line-height:1.7}
    .shared-album-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}
    .shared-album-input{min-width:0;flex:1;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;padding:10px 12px;font:inherit}
    .shared-album-button{border:1px solid rgba(255,217,138,.45);border-radius:10px;background:rgba(255,217,138,.12);color:#ffe4a3;padding:9px 13px;font:inherit;cursor:pointer}
    .shared-album-button:hover{background:rgba(255,217,138,.2)}
    .shared-album-close{border:0;background:transparent;color:#fff;font-size:25px;cursor:pointer;line-height:1}
    .shared-album-status{min-height:1.5em;color:#ffe4a3;font-size:13px}
    .shared-album-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:12px;margin-top:14px}
    .shared-album-photo{overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:rgba(255,255,255,.045)}
    .shared-album-photo img{display:block;width:100%;height:150px;object-fit:cover;background:rgba(255,255,255,.04)}
    .shared-album-photo-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;font-size:11px;color:rgba(255,255,255,.75)}
    .shared-album-delete{border:0;background:transparent;color:#ffb7b7;cursor:pointer;font:inherit}
    .shared-album-empty{padding:24px 12px;text-align:center;color:rgba(255,255,255,.58);font-size:13px}
    @media(max-width:520px){.shared-album-card{padding:16px}.shared-album-photo img{height:125px}}
  `;
  document.head.append(style);

  function addSharedAlbumButton() {
    if (document.querySelector("[data-shared-album-trigger]")) return;
    const localAlbumButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "回忆相册",
    );
    if (!localAlbumButton) return;

    const sharedButton = localAlbumButton.cloneNode(true);
    sharedButton.dataset.sharedAlbumTrigger = "true";
    sharedButton.textContent = "共享相册";
    sharedButton.setAttribute("aria-label", "打开共享回忆相册");
    sharedButton.title = "和受邀成员共享照片";
    sharedButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openModal();
    });
    localAlbumButton.insertAdjacentElement("afterend", sharedButton);
  }

  const buttonObserver = new MutationObserver(addSharedAlbumButton);
  buttonObserver.observe(document.documentElement, { childList: true, subtree: true });
  addSharedAlbumButton();

  function setStatus(message, isError = false) {
    const status = modal?.querySelector("[data-shared-status]");
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#ffb7b7" : "#ffe4a3";
  }

  function closeModal() {
    if (activeChannel && supabase) {
      supabase.removeChannel(activeChannel);
      activeChannel = undefined;
    }
    modal?.remove();
    modal = undefined;
  }

  function signedInMarkup(user) {
    const area = modal.querySelector("[data-shared-member-area]");
    const email = modal.querySelector("[data-shared-email]");
    const authArea = modal.querySelector("[data-shared-auth-area]");
    authArea.hidden = Boolean(user);
    area.hidden = !user;
    if (user) email.textContent = user.email || "已登录成员";
  }

  async function refreshGallery() {
    if (!modal || !currentUser) return;
    const gallery = modal.querySelector("[data-shared-gallery]");
    const { data: rows, error } = await supabase
      .from(TABLE)
      .select("id,storage_path,original_name,uploader_id,created_at")
      .eq("album_id", ALBUM_ID)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("暂时无法读取共享相册，请稍后重试。", true);
      return;
    }

    gallery.replaceChildren();
    if (!rows?.length) {
      const empty = document.createElement("div");
      empty.className = "shared-album-empty";
      empty.textContent = "相册还是空的，上传一张照片开始分享吧。";
      gallery.append(empty);
      return;
    }

    const photos = await Promise.all(
      rows.map(async (row) => {
        const { data, error: urlError } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(row.storage_path, 60 * 60);
        return urlError ? null : { ...row, url: data.signedUrl };
      }),
    );

    for (const photo of photos.filter(Boolean)) {
      const card = document.createElement("article");
      card.className = "shared-album-photo";
      const image = document.createElement("img");
      image.src = photo.url;
      image.alt = photo.original_name || "共享相册照片";
      image.loading = "lazy";
      card.append(image);

      const footer = document.createElement("div");
      footer.className = "shared-album-photo-footer";
      const name = document.createElement("span");
      name.textContent = photo.original_name || "照片";
      name.title = name.textContent;
      footer.append(name);

      if (photo.uploader_id === currentUser.id) {
        const remove = document.createElement("button");
        remove.className = "shared-album-delete";
        remove.type = "button";
        remove.textContent = "删除";
        remove.addEventListener("click", () => deletePhoto(photo));
        footer.append(remove);
      }
      card.append(footer);
      gallery.append(card);
    }
  }

  async function deletePhoto(photo) {
    setStatus("正在删除照片…");
    const { error: fileError } = await supabase.storage
      .from(BUCKET)
      .remove([photo.storage_path]);
    if (fileError) {
      setStatus("删除失败；请检查相册访问规则。", true);
      return;
    }
    const { error: rowError } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", photo.id)
      .eq("uploader_id", currentUser.id);
    if (rowError) {
      setStatus("照片文件已删除，但相册记录未能更新。", true);
      return;
    }
    setStatus("照片已删除。");
    await refreshGallery();
  }

  async function uploadFiles(files) {
    if (!currentUser) return;
    const fileList = [...files];
    if (!fileList.length) return;

    for (const file of fileList) {
      const extension = EXTENSIONS[file.type];
      if (!extension) {
        setStatus("目前支持 JPG、PNG、WebP 和 GIF 图片。", true);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setStatus("每张照片不能超过 8 MB。", true);
        continue;
      }

      setStatus(`正在上传：${file.name}`);
      const storagePath = `${ALBUM_ID}/${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setStatus("上传失败；请检查网络和相册访问规则。", true);
        continue;
      }

      const { error: rowError } = await supabase.from(TABLE).insert({
        album_id: ALBUM_ID,
        storage_path: storagePath,
        original_name: file.name.slice(0, 180),
        uploader_id: currentUser.id,
      });
      if (rowError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        setStatus("照片已上传，但登记到共享相册失败。", true);
        continue;
      }
      setStatus("照片已同步给相册成员。");
    }

    await refreshGallery();
  }

  function subscribeToPhotos() {
    if (activeChannel || !currentUser) return;
    activeChannel = supabase
      .channel(`shared-album-${ALBUM_ID}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `album_id=eq.${ALBUM_ID}` },
        () => refreshGallery(),
      )
      .subscribe();
  }

  async function showSignedInState() {
    if (!modal) return;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setStatus("登录状态读取失败，请刷新后重试。", true);
      return;
    }
    currentUser = data.session?.user || null;
    signedInMarkup(currentUser);
    if (currentUser) {
      subscribeToPhotos();
      await refreshGallery();
    }
  }

  function openModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "shared-album-backdrop";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "共享回忆相册");
    modal.innerHTML = `
      <section class="shared-album-card">
        <header class="shared-album-head">
          <div class="shared-album-title">共享回忆相册</div>
          <button class="shared-album-close" type="button" aria-label="关闭">×</button>
        </header>
        <p class="shared-album-muted">只有受邀成员登录后，才能查看或上传这个相册里的照片。</p>
        <form data-shared-auth-area>
          <label class="shared-album-muted" for="shared-album-email">受邀邮箱</label>
          <div class="shared-album-row">
            <input class="shared-album-input" id="shared-album-email" type="email" autocomplete="email" required placeholder="name@example.com">
            <button class="shared-album-button" type="submit">发送登录链接</button>
          </div>
        </form>
        <div data-shared-member-area hidden>
          <div class="shared-album-row">
            <span class="shared-album-muted" data-shared-email></span>
            <button class="shared-album-button" data-shared-signout type="button">退出登录</button>
          </div>
          <label class="shared-album-button" for="shared-album-files">上传照片</label>
          <input id="shared-album-files" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
          <div class="shared-album-gallery" data-shared-gallery></div>
        </div>
        <p class="shared-album-status" data-shared-status role="status" aria-live="polite"></p>
      </section>`;
    document.body.append(modal);

    modal.querySelector(".shared-album-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    modal.querySelector("[data-shared-auth-area]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = modal.querySelector("#shared-album-email").value.trim();
      setStatus("正在发送登录链接…");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
      });
      setStatus(
        error ? "未能发送链接；请确认邮箱已受邀。" : "登录链接已发送，请查看邮箱。",
        Boolean(error),
      );
    });
    modal.querySelector("[data-shared-signout]").addEventListener("click", async () => {
      await supabase.auth.signOut();
      currentUser = null;
      signedInMarkup(null);
      modal.querySelector("[data-shared-gallery]").replaceChildren();
      setStatus("已退出登录。");
    });
    modal.querySelector("#shared-album-files").addEventListener("change", async (event) => {
      await uploadFiles(event.target.files || []);
      event.target.value = "";
    });
    showSignedInState();
  }

  import("https://esm.sh/@supabase/supabase-js@2")
    .then(({ createClient }) => {
      supabase = createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null;
        if (modal) {
          signedInMarkup(currentUser);
          if (currentUser) {
            subscribeToPhotos();
            refreshGallery();
          }
        }
      });
      authSubscription = data.subscription;
      void authSubscription;
      addSharedAlbumButton();
    })
    .catch(() => {
      console.error("Shared album could not connect to its configured service.");
    });
})();

