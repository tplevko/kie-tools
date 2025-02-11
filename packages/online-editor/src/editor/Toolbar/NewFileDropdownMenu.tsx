/*
 * Copyright 2021 Red Hat, Inc. and/or its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaces, WorkspaceFile } from "@kie-tools-core/workspaces-git-fs/dist/context/WorkspacesContext";
import { FileLabel } from "../../filesList/FileLabel";
import { Flex, FlexItem } from "@patternfly/react-core/dist/js/layouts/Flex";
import { Divider } from "@patternfly/react-core/dist/js/components/Divider";
import {
  DrilldownMenu,
  Menu,
  MenuContent,
  MenuGroup,
  MenuInput,
  MenuItem,
  MenuList,
} from "@patternfly/react-core/dist/js/components/Menu";
import {
  SupportedFileExtensions,
  useEditorEnvelopeLocator,
} from "../../envelopeLocator/hooks/EditorEnvelopeLocatorContext";
import { Button, ButtonVariant } from "@patternfly/react-core/dist/js/components/Button";
import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/js/components/Alert";
import { basename, extname } from "path";
import { ImportSingleFileFromUrlForm } from "../../importFromUrl/ImportSingleFileFromUrlForm";
import { ImportableUrl, UrlType, useImportableUrl } from "../../importFromUrl/ImportableUrlHooks";
import { useRoutes } from "../../navigation/Hooks";
import { fetchSingleFileContent } from "../../importFromUrl/fetchSingleFileContent";
import { useAuthSession, useAuthSessions } from "../../authSessions/AuthSessionsContext";
import { useGitHubClient } from "../../github/Hooks";
import { useAuthProviders } from "../../authProviders/AuthProvidersContext";
import { getCompatibleAuthSessionWithUrlDomain } from "../../authSessions/CompatibleAuthSessions";
import { decoder } from "@kie-tools-core/workspaces-git-fs/dist/encoderdecoder/EncoderDecoder";
import { WorkspaceDescriptor } from "@kie-tools-core/workspaces-git-fs/dist/worker/api/WorkspaceDescriptor";
import { useGlobalAlert } from "../../alerts";
import { useBitbucketClient } from "../../bitbucket/Hooks";
import { isEditable } from "../../envelopeLocator/EditorEnvelopeLocatorFactory";

const ROOT_MENU_ID = "addFileRootMenu";

export function NewFileDropdownMenu(props: {
  destinationDirPath: string;
  workspaceDescriptor: WorkspaceDescriptor;
  onAddFile: (file?: WorkspaceFile) => Promise<void>;
}) {
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  const [menuDrilledIn, setMenuDrilledIn] = useState<string[]>([]);
  const [drilldownPath, setDrilldownPath] = useState<string[]>([]);
  const [menuHeights, setMenuHeights] = useState<{ [key: string]: number }>({});
  const [activeMenu, setActiveMenu] = useState(ROOT_MENU_ID);

  const drillIn = useCallback((_event, fromMenuId, toMenuId, pathId) => {
    setMenuDrilledIn((prev) => [...prev, fromMenuId]);
    setDrilldownPath((prev) => [...prev, pathId]);
    setActiveMenu(toMenuId);
  }, []);

  const drillOut = useCallback((_event, toMenuId) => {
    setMenuDrilledIn((prev) => prev.slice(0, prev.length - 1));
    setDrilldownPath((prev) => prev.slice(0, prev.length - 1));
    setActiveMenu(toMenuId);
  }, []);

  const setHeight = useCallback((menuId: string, height: number) => {
    setMenuHeights((prev) => {
      if (prev[menuId] === undefined || (menuId !== ROOT_MENU_ID && prev[menuId] !== height)) {
        return { ...prev, [menuId]: height };
      }
      return prev;
    });
  }, []);

  const workspaces = useWorkspaces();
  const routes = useRoutes();
  const editorEnvelopeLocator = useEditorEnvelopeLocator();
  const { gitConfig } = useAuthSession(props.workspaceDescriptor.gitAuthSessionId);

  const addEmptyFile = useCallback(
    async (extension: SupportedFileExtensions) => {
      const file = await workspaces.addEmptyFile({
        workspaceId: props.workspaceDescriptor.workspaceId,
        destinationDirRelativePath: props.destinationDirPath,
        extension,
      });
      await props.onAddFile(file);
    },
    [props, workspaces]
  );

  const urlInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (activeMenu === "importFromUrlMenu") {
      setTimeout(() => {
        urlInputRef.current?.focus();
      }, 500);
    }
  }, [activeMenu, urlInputRef]);

  const [isImporting, setImporting] = useState(false);
  const [importingError, setImportingError] = useState<string>();

  const successfullyUploadedAlert = useGlobalAlert(
    useCallback(({ close }, staticArgs: { qtt: number }) => {
      return (
        <Alert
          variant="success"
          title={`Successfully uploaded ${staticArgs.qtt} file(s).`}
          actionClose={<AlertActionCloseButton onClose={close} />}
        />
      );
    }, []),
    { durationInSeconds: 4 }
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const filesToUpload = await Promise.all(
        Array.from(e.target.files ?? []).map(async (file: File) => {
          return {
            path: file.name,
            content: await new Promise<string>((res) => {
              const reader = new FileReader();
              reader.onload = (event: ProgressEvent<FileReader>) =>
                res(decoder.decode(event.target?.result as ArrayBuffer));
              reader.readAsArrayBuffer(file);
            }),
          };
        })
      );

      const uploadedFiles = await Promise.all(
        filesToUpload.map(async (file) => {
          return workspaces.addFile({
            workspaceId: props.workspaceDescriptor.workspaceId,
            name: basename(file.path, extname(file.path)),
            extension: extname(file.path).replace(".", ""),
            content: file.content,
            destinationDirRelativePath: props.destinationDirPath,
          });
        })
      );

      // Since non-editable files are not checked for changes, manually stage and commit these files
      await Promise.all(
        uploadedFiles.map(async (file) => {
          if (!isEditable(file.relativePath)) {
            return workspaces.stageFile({
              workspaceId: props.workspaceDescriptor.workspaceId,
              relativePath: file.relativePath,
            });
          }
        })
      );
      await workspaces.createSavePoint({
        workspaceId: props.workspaceDescriptor.workspaceId,
        gitConfig,
        commitMessage: `KIE Sandbox: Added files${uploadedFiles.map((file) => `\n- ${file.relativePath}`)}`,
        forceHasChanges: true,
      });

      const fileToGoTo = uploadedFiles.filter((file) => editorEnvelopeLocator.hasMappingFor(file.relativePath)).pop();

      await props.onAddFile(fileToGoTo);
      successfullyUploadedAlert.show({ qtt: uploadedFiles.length });
    },
    [editorEnvelopeLocator, workspaces, props, successfullyUploadedAlert, gitConfig]
  );

  const [url, setUrl] = useState("");
  const [authSessionId, setAuthSessionId] = useState(props.workspaceDescriptor.gitAuthSessionId);

  const importableUrl = useImportableUrl(
    url,
    useMemo(
      () => [
        UrlType.FILE,
        UrlType.GIST_DOT_GITHUB_DOT_COM_FILE,
        UrlType.GITHUB_DOT_COM_FILE,
        UrlType.BITBUCKET_DOT_ORG_FILE,
        UrlType.BITBUCKET_DOT_ORG_SNIPPET_FILE,
      ],
      []
    )
  );

  const { authSession } = useAuthSession(authSessionId);
  const gitHubClient = useGitHubClient(authSession);
  const bitbucketClient = useBitbucketClient(authSession);

  // Select authSession based on the importableUrl domain (begin)
  const authProviders = useAuthProviders();
  const { authSessions, authSessionStatus } = useAuthSessions();

  useEffect(() => {
    if (importableUrl.error) {
      return;
    }

    const urlDomain = importableUrl.url?.hostname;

    const { compatible } = getCompatibleAuthSessionWithUrlDomain({
      authProviders,
      authSessions,
      authSessionStatus,
      urlDomain,
    });
    setAuthSessionId(compatible[0]!.id);
  }, [authProviders, authSessionStatus, authSessions, importableUrl]);
  // Select authSession based on the importableUrl domain (end)

  const importFromUrl = useCallback(
    async (importableUrl: ImportableUrl) => {
      if (!importableUrl.url) {
        return;
      }

      setImporting(true);
      setImportingError(undefined);

      try {
        const { error, rawUrl, content } = await fetchSingleFileContent(importableUrl, gitHubClient, bitbucketClient);
        if (error) {
          setImportingError(error);
          return;
        }

        const extension = extname(rawUrl!.pathname).replace(".", "");
        const name = decodeURIComponent(basename(rawUrl!.pathname, extname(rawUrl!.pathname)));

        const file = await workspaces.addFile({
          workspaceId: props.workspaceDescriptor.workspaceId,
          name,
          extension,
          content: content!,
          destinationDirRelativePath: props.destinationDirPath,
        });
        await props.onAddFile(file);
      } catch (e) {
        setImportingError(e.toString());
      } finally {
        setImporting(false);
      }
    },
    [gitHubClient, bitbucketClient, workspaces, props]
  );

  const sampleUrl = useCallback(
    (extension: SupportedFileExtensions) =>
      `${window.location.origin}${window.location.pathname}${routes.static.sample.path({ type: extension })}`,
    [routes]
  );

  const importableUrlBpmnSample = useImportableUrl(sampleUrl("bpmn"));
  const importableUrlDmnSample = useImportableUrl(sampleUrl("dmn"));
  const importableUrlPmmlSample = useImportableUrl(sampleUrl("pmml"));

  return (
    <Menu
      tabIndex={1}
      style={{ boxShadow: "none", minWidth: "400px" }}
      id={ROOT_MENU_ID}
      containsDrilldown={true}
      onDrillIn={drillIn}
      onDrillOut={drillOut}
      activeMenu={activeMenu}
      onGetMenuHeight={setHeight}
      drilldownItemPath={drilldownPath}
      drilledInMenus={menuDrilledIn}
    >
      <MenuContent menuHeight={`${menuHeights[activeMenu]}px`}>
        <MenuList style={{ padding: 0 }}>
          <MenuItem
            itemId={"newBpmnItemId"}
            onClick={() => addEmptyFile("bpmn")}
            description="BPMN files are used to generate business workflows."
          >
            <b>
              <FileLabel style={{ marginBottom: "4px" }} extension={"bpmn"} />
            </b>
          </MenuItem>
          <MenuItem
            itemId={"newDmnItemId"}
            onClick={() => addEmptyFile("dmn")}
            description="DMN files are used to generate decision models"
          >
            <b>
              <FileLabel style={{ marginBottom: "4px" }} extension={"dmn"} />
            </b>
          </MenuItem>
          <MenuItem
            itemId={"newPmmlItemId"}
            onClick={() => addEmptyFile("pmml")}
            description="PMML files are used to generate scorecards"
          >
            <b>
              <FileLabel style={{ marginBottom: "4px" }} extension={"pmml"} />
            </b>
          </MenuItem>
          <Divider />
          <MenuItem
            description={"Try sample models"}
            itemId="samplesItemId"
            direction={"down"}
            drilldownMenu={
              <DrilldownMenu id={"samplesMenu"}>
                <MenuItem direction="up">Back</MenuItem>
                <Divider />
                <MenuGroup label={" "}>
                  <MenuItem
                    onClick={() => importFromUrl(importableUrlBpmnSample)}
                    description="BPMN files are used to generate business workflows."
                  >
                    <Flex>
                      <FlexItem>Sample</FlexItem>
                      <FlexItem>
                        <FileLabel extension={"bpmn"} />
                      </FlexItem>
                    </Flex>
                  </MenuItem>
                </MenuGroup>
                <MenuGroup label={" "}>
                  <MenuItem
                    onClick={() => importFromUrl(importableUrlDmnSample)}
                    description="DMN files are used to generate decision models"
                  >
                    <Flex>
                      <FlexItem>Sample</FlexItem>
                      <FlexItem>
                        <FileLabel extension={"dmn"} />
                      </FlexItem>
                    </Flex>
                  </MenuItem>
                </MenuGroup>
                <MenuGroup label={" "}>
                  <MenuItem
                    onClick={() => importFromUrl(importableUrlPmmlSample)}
                    description="PMML files are used to generate scorecards"
                  >
                    <Flex>
                      <FlexItem>Sample</FlexItem>
                      <FlexItem>
                        <FileLabel extension={"pmml"} />
                      </FlexItem>
                    </Flex>
                  </MenuItem>
                </MenuGroup>
              </DrilldownMenu>
            }
          >
            Samples
          </MenuItem>
          <Divider />
          <MenuItem
            itemId={"importFromUrlItemId"}
            direction={"down"}
            drilldownMenu={
              <DrilldownMenu id={"importFromUrlMenu"}>
                <MenuItem direction="up">Back</MenuItem>
                <Divider />
                {/* Allows for arrows to work when editing the text. */}
                <MenuInput onKeyDown={(e) => e.stopPropagation()}>
                  <ImportSingleFileFromUrlForm
                    authSessionSelectHelperText={`Changing it here won't change it on '${props.workspaceDescriptor.name}'`}
                    importingError={importingError}
                    importableUrl={importableUrl}
                    urlInputRef={urlInputRef}
                    url={url}
                    setUrl={(url) => {
                      setUrl(url);
                      setImportingError(undefined);
                    }}
                    authSessionId={authSessionId}
                    setAuthSessionId={setAuthSessionId}
                    onSubmit={() => importFromUrl(importableUrl)}
                  />
                </MenuInput>
                <MenuInput>
                  <Button
                    variant={ButtonVariant.primary}
                    isDisabled={!!importableUrl.error}
                    isLoading={isImporting}
                    onClick={() => importFromUrl(importableUrl)}
                  >
                    Import
                  </Button>
                </MenuInput>
              </DrilldownMenu>
            }
          >
            From URL
          </MenuItem>
          <MenuItem itemId={"importUploadingItemId"} onClick={() => uploadFileInputRef.current?.click()}>
            Upload...
            <input
              ref={uploadFileInputRef}
              type="file"
              multiple={true}
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
          </MenuItem>
        </MenuList>
      </MenuContent>
    </Menu>
  );
}
