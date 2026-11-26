// Public, credential-free distribution for manually requested local-mode updates.
use crate::{
    updater::{Manifest, Release, LIMIT},
    Result,
};
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

const RELEASES: &str = "https://api.github.com/repos/zydjx7/futari-desktop/releases";
const DOWNLOAD: &str = "https://github.com/zydjx7/futari-desktop/releases/download";

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
}

pub struct Github(Client);
impl Github {
    pub fn new() -> Result<Self> {
        Client::builder()
            .https_only(true)
            .user_agent("FUTARI-Desktop-Updater")
            .timeout(Duration::from_secs(45))
            .build()
            .map(Self)
            .map_err(|e| e.to_string())
    }

    async fn read(&self, url: String, limit: usize) -> Result<Vec<u8>> {
        let mut response = self
            .0
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if chunk.len() > limit - data.len() {
                return Err("GitHub 更新响应过大".into());
            }
            data.extend_from_slice(&chunk);
        }
        Ok(data)
    }

    async fn manifest(&self, version: &str) -> Result<Option<Release>> {
        let raw = self
            .read(format!("{DOWNLOAD}/ui-{version}/manifest.json"), 65536)
            .await?;
        let manifest: Manifest = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        match manifest.ui {
            Some(ui) if ui.version == version => Ok(Some(ui)),
            _ => Err("GitHub 资源清单与发布标签不一致".into()),
        }
    }

    pub async fn latest(&self) -> Result<Option<Release>> {
        // Prefer the public Atom feed; unauthenticated API quotas are shared per IP.
        let feed = self
            .read(
                "https://github.com/zydjx7/futari-desktop/releases.atom".into(),
                2 << 20,
            )
            .await?;
        let mut reader = quick_xml::Reader::from_reader(feed.as_slice());
        loop {
            use quick_xml::events::Event;
            match reader.read_event().map_err(|e| e.to_string())? {
                Event::Start(tag) if tag.name().as_ref() == "id" => {
                    let id = reader.read_text(tag.name()).map_err(|e| e.to_string())?;
                    if let Some((_, version)) = id.rsplit_once("/ui-") {
                        let parts: Vec<_> = version.split('.').collect();
                        if parts.len() == 4
                            && parts
                                .iter()
                                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
                            && crate::updater::version(version)
                        {
                            return self.manifest(version).await;
                        }
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
        for page in 1.. {
            let data = self
                .read(format!("{RELEASES}?per_page=30&page={page}"), 4 << 20)
                .await?;
            let releases: Vec<GithubRelease> =
                serde_json::from_slice(&data).map_err(|e| e.to_string())?;
            let last = releases.len() < 30;
            for release in releases {
                let Some(version) = release.tag_name.strip_prefix("ui-") else {
                    continue;
                };
                if release.draft || release.prerelease || !crate::updater::version(version) {
                    continue;
                }
                let zip = format!("ui-{version}.zip");
                if !["manifest.json", &zip]
                    .iter()
                    .all(|name| release.assets.iter().any(|a| &a.name == name))
                {
                    continue;
                }
                return self.manifest(version).await;
            }
            if last {
                break;
            }
        }
        Ok(None)
    }

    pub async fn bundle(&self, version: &str) -> Result<Vec<u8>> {
        self.read(format!("{DOWNLOAD}/ui-{version}/ui-{version}.zip"), LIMIT)
            .await
    }
}
